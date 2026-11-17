import { extractExecError } from '../../git/command-runner/process-capture/exec-error'
import { glabExecFileAsync } from '../../git/command-runner/hosted-cli/glab-exec-file'
import type { LocalGitExecOptions } from '../projects/gitlab-known-host-probe'
import { glabHostnameArgs, glabRepoExecOptions } from '../projects/gitlab-project-ref-resolution'
import type { ProjectRef } from '../projects/project-ref-parser'
import { classifyGlabError } from '../requests/glab-error-classification'
import { acquire, release } from '../requests/glab-request-admission'
import {
  onlyMissingFields,
  parseWorkItemStatusesResponse,
  parseWorkItemStatusTargetResponse,
  parseWorkItemStatusUpdateResponse,
  type GitLabWorkItemStatusesRead,
  type GitLabWorkItemStatusTargetRead
} from './work-item-status-response'

// A board read must not wait the full CLI deadline on an optional field.
const STATUS_READ_TIMEOUT_MS = 15_000
const STATUS_FRAGMENT = '... on WorkItemWidgetStatus { status { id name } }'
// GitLab 18.0 added the lifecycle defaults; older status schemas reject them.
const LIFECYCLE_DEFAULTS = ['defaultOpenStatus', 'defaultClosedStatus']

const warnedProjects = new Set<string>()

/** glab exits 1 on a GraphQL errors array; its stdout still carries the reply. Throws otherwise. */
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
  } catch (error) {
    try {
      return JSON.parse(extractExecError(error).stdout)
    } catch {
      throw error
    }
  } finally {
    release()
  }
}

function errorMessage(error: unknown): string {
  return classifyGlabError(error instanceof Error ? error.message : String(error)).message
}

function projectWorkItemsQuery(projectRef: ProjectRef, iids: readonly number[], fields: string) {
  const iidList = iids.map((iid) => JSON.stringify(String(iid))).join(', ')
  return `query { project(fullPath: ${JSON.stringify(projectRef.path)}) { workItems(iids: [${iidList}], first: ${iids.length}) { nodes { ${fields} } } } }`
}

/** One read for the issues' Status; never throws, so a board read can fall back to labels. */
export async function getWorkItemStatuses(
  repoPath: string,
  projectRef: ProjectRef,
  iids: readonly number[],
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitLabWorkItemStatusesRead> {
  if (iids.length === 0) {
    return { kind: 'statuses', statuses: new Map() }
  }
  let read: GitLabWorkItemStatusesRead
  try {
    read = parseWorkItemStatusesResponse(
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
    read = { kind: 'failed', error: errorMessage(error) }
  }
  const key = `${read.kind}:${projectRef.host}/${projectRef.path}`
  if (read.kind !== 'statuses' && !warnedProjects.has(key)) {
    warnedProjects.add(key)
    console.warn(
      `[gitlab] work item statuses ${read.kind} for ${projectRef.host}/${projectRef.path}`,
      read.kind === 'failed' ? read.error : ''
    )
  }
  return read
}

/** The item's global ID, Status and allowed statuses, for a move; never throws. */
export async function getWorkItemStatusTarget(
  repoPath: string,
  projectRef: ProjectRef,
  iid: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitLabWorkItemStatusTargetRead> {
  const read = (defaults: string) =>
    runGraphql(
      repoPath,
      projectRef,
      projectWorkItemsQuery(
        projectRef,
        [iid],
        `id iid widgets { ${STATUS_FRAGMENT} } workItemType { widgetDefinitions { ... on WorkItemWidgetDefinitionStatus { allowedStatuses { id name } ${defaults} } } }`
      ),
      connectionId,
      localGitOptions
    )
  try {
    let payload = await read(LIFECYCLE_DEFAULTS.map((field) => `${field} { id name }`).join(' '))
    if (onlyMissingFields(payload, LIFECYCLE_DEFAULTS)) {
      // Before 18.0: moves still work by rule match, without the todo/done defaults.
      payload = await read('')
    }
    return parseWorkItemStatusTargetResponse(payload, iid)
  } catch (error) {
    return { kind: 'failed', error: errorMessage(error) }
  }
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
    return { ok: false, error: errorMessage(error) }
  }
}
