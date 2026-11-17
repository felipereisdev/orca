import type { GitLabWorkItemStatus } from '../../../shared/gitlab/gitlab-types'
import { extractExecError } from '../../git/command-runner/process-capture/exec-error'
import { glabExecFileAsync } from '../../git/command-runner/hosted-cli/glab-exec-file'
import type { LocalGitExecOptions } from '../projects/gitlab-known-host-probe'
import { glabHostnameArgs, glabRepoExecOptions } from '../projects/gitlab-project-ref-resolution'
import type { ProjectRef } from '../projects/project-ref-parser'
import { classifyGlabError } from '../requests/glab-error-classification'
import { acquire, release } from '../requests/glab-request-admission'
import {
  parseWorkItemStatusesResponse,
  parseWorkItemStatusTargetResponse,
  parseWorkItemStatusUpdateResponse,
  type GitLabWorkItemStatusTarget
} from './work-item-status-response'

// A board read must not wait the full CLI deadline on an optional field.
const STATUS_READ_TIMEOUT_MS = 15_000
const STATUS_FRAGMENT = '... on WorkItemWidgetStatus { status { id name } }'

const warnedProjects = new Set<string>()

/** glab exits 1 on a GraphQL errors array; its stdout still carries the reply. */
async function runGraphql(
  repoPath: string,
  projectRef: ProjectRef,
  query: string,
  connectionId: string | null | undefined,
  localGitOptions: LocalGitExecOptions,
  timeout?: number
): Promise<unknown> {
  await acquire()
  try {
    const { stdout } = await glabExecFileAsync(
      ['api', ...glabHostnameArgs(projectRef, connectionId), 'graphql', '-f', `query=${query}`],
      {
        ...glabRepoExecOptions(repoPath, connectionId, localGitOptions),
        ...(timeout ? { timeout } : {})
      }
    )
    return JSON.parse(stdout)
  } finally {
    release()
  }
}

function projectWorkItemsQuery(projectRef: ProjectRef, iids: readonly number[], fields: string) {
  const iidList = iids.map((iid) => JSON.stringify(String(iid))).join(', ')
  return `query { project(fullPath: ${JSON.stringify(projectRef.path)}) { workItems(iids: [${iidList}], first: ${iids.length}) { nodes { ${fields} } } } }`
}

/** One read for the listed issues' Status; null when the instance has no statuses or fails. */
export async function getWorkItemStatuses(
  repoPath: string,
  projectRef: ProjectRef,
  iids: readonly number[],
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<Map<number, GitLabWorkItemStatus | null> | null> {
  if (iids.length === 0) {
    return new Map()
  }
  let statuses: Map<number, GitLabWorkItemStatus | null> | null
  let cause: unknown = null
  try {
    statuses = parseWorkItemStatusesResponse(
      await runGraphql(
        repoPath,
        projectRef,
        projectWorkItemsQuery(projectRef, iids, `iid widgets { ${STATUS_FRAGMENT} }`),
        connectionId,
        localGitOptions,
        STATUS_READ_TIMEOUT_MS
      )
    )
  } catch (error) {
    statuses = null
    cause = error
  }
  const key = `${projectRef.host}/${projectRef.path}`
  if (!statuses && !warnedProjects.has(key)) {
    warnedProjects.add(key)
    console.warn(`[gitlab] work item statuses unavailable for ${key}; using labels`, cause ?? '')
  }
  return statuses
}

/** The item's global ID, Status and allowed statuses; null when it has no status widget. */
export async function getWorkItemStatusTarget(
  repoPath: string,
  projectRef: ProjectRef,
  iid: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitLabWorkItemStatusTarget | null> {
  const fields = `id iid widgets { ${STATUS_FRAGMENT} } workItemType { widgetDefinitions { ... on WorkItemWidgetDefinitionStatus { allowedStatuses { id name } defaultOpenStatus { id name } defaultClosedStatus { id name } } } }`
  return parseWorkItemStatusTargetResponse(
    await runGraphql(
      repoPath,
      projectRef,
      projectWorkItemsQuery(projectRef, [iid], fields),
      connectionId,
      localGitOptions
    ),
    iid
  )
}

/** Sets the Status alone; GitLab closes or reopens the item when the status category requires it. */
export async function updateWorkItemStatus(
  repoPath: string,
  projectRef: ProjectRef,
  workItemId: string,
  statusId: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mutation = `mutation { workItemUpdate(input: { id: ${JSON.stringify(workItemId)}, statusWidget: { status: ${JSON.stringify(statusId)} } }) { workItem { id } errors } }`
  try {
    return parseWorkItemStatusUpdateResponse(
      await runGraphql(repoPath, projectRef, mutation, connectionId, localGitOptions)
    )
  } catch (error) {
    const { stdout } = extractExecError(error)
    try {
      return parseWorkItemStatusUpdateResponse(JSON.parse(stdout))
    } catch {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: classifyGlabError(message).message }
    }
  }
}
