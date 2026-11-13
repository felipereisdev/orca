import { projectGroupIdFromRepoId } from '../../shared/folder-workspaces/folder-workspace-worktree'
import type { ProjectGroup } from '../../shared/project-group-types'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { ProjectHostSetup } from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
import type { RuntimeReferenceListResult } from '../../shared/runtime-reference-contracts'
import type { HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { resolveJiraTarget } from '../jira/jira-target'
import {
  assertReferenceWritesSupported,
  resolveReferenceInputs
} from '../references/reference-input'
import { RuntimeClientError } from '../runtime/types'
import type { CliRepoTarget } from './worktree-project-target'

export async function resolveWorktreeJiraLink(
  context: HandlerContext,
  target: CliRepoTarget | { worktree: string }
) {
  const input = getOptionalStringFlag(context.flags, 'jira-issue')
  if (input === undefined) {
    if (context.flags.has('jira-site')) {
      throw new RuntimeClientError('invalid_argument', '--jira-site requires --jira-issue.')
    }
    return undefined
  }
  const issue = await resolveJiraTarget(context, input, { siteFlag: 'jira-site' })
  const flags = new Map(context.flags)
  flags.set('reference-site', issue.siteId)
  const items = await resolveReferenceInputs({ ...context, flags }, [{ key: issue.key }])
  await assertReferenceWritesSupported(context.client)
  let setup:
    | (Pick<ProjectHostSetup, 'projectId' | 'hostId' | 'id'> & { repoId: string | null })
    | undefined
  let base: RuntimeReferenceListResult['references'] | undefined
  if ('worktree' in target) {
    const { result } = await context.client.call<RuntimeReferenceListResult>(
      'reference.list',
      target
    )
    base = result.references
    const workspace = result.worktree
    if (workspace.kind === 'folder') {
      const groupId = projectGroupIdFromRepoId(workspace.repoId)
      const {
        result: { groups }
      } = await context.client.call<{ groups: ProjectGroup[] }>('projectGroup.list')
      if (!groupId || !groups.some((group) => group.id === groupId) || !workspace.hostId) {
        throw new RuntimeClientError(
          'invalid_argument',
          'Cannot verify this folder workspace’s project group and host. Refresh the folder in Orca, then run orca worktree show --worktree <selector> --json and retry with the exact folder selector.'
        )
      }
      setup = { projectId: groupId, hostId: workspace.hostId, id: '', repoId: null }
    } else if (workspace.projectId && workspace.hostId) {
      setup = {
        projectId: workspace.projectId,
        hostId: workspace.hostId,
        id: workspace.projectHostSetupId ?? '',
        repoId: workspace.repoId
      }
    }
  } else {
    const {
      result: { repo }
    } = await context.client.call<{ repo: Repo }>('repo.show', target)
    const {
      result: { setups }
    } = await context.client.call<{ setups: ProjectHostSetup[] }>('projectHostSetup.list')
    const candidates = setups.filter(
      (entry) =>
        entry.repoId === repo.id &&
        entry.hostId === (target.repoHostId ?? getRepoExecutionHostId(repo))
    )
    if (candidates.length === 1) {
      setup = candidates[0]
    }
  }
  if (!setup) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Cannot prove the workspace project and host for this Jira attachment. Run orca worktree show --worktree <selector> --json; refresh its project setup in Orca and retry with an exact workspace or --project/--host target.'
    )
  }
  const linkedItems = items.map((item) => ({
    ...item,
    taskSourceContext: {
      kind: 'task-source' as const,
      provider: 'jira' as const,
      projectId: setup.projectId,
      hostId: setup.hostId,
      repoId: setup.repoId,
      projectHostSetupId: setup.id || null,
      providerIdentity: {
        provider: 'jira' as const,
        siteId: issue.siteId,
        siteUrl: issue.site.siteUrl,
        projectKey: issue.key.slice(0, issue.key.lastIndexOf('-'))
      }
    }
  }))
  if (!base) {
    return { linkedItems }
  }
  const previous = base.map(({ key: _key, selected: _selected, ...item }) => item)
  return {
    linkedItemsBase: previous,
    linkedItems: [...previous, ...linkedItems],
    linkedItemsSelectionChanged: false
  }
}

export async function resolveWorktreeCreateReferences(
  context: HandlerContext,
  inputs: Parameters<typeof resolveReferenceInputs>[1] | undefined
) {
  if (!inputs) {
    return undefined
  }
  const linkedItems = await resolveReferenceInputs(context, inputs)
  await assertReferenceWritesSupported(context.client)
  return linkedItems
}

export function assertWorktreeJiraFlagsCompatible(flags: Map<string, string | boolean>): void {
  if (!flags.has('jira-issue')) {
    return
  }
  const conflict = ['reference', 'pr', 'issue', 'linear-issue', 'gitlab-issue', 'gitlab-mr'].find(
    (flag) => flags.has(flag)
  )
  if (conflict) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Cannot combine --jira-issue with --${conflict}. Set the Jira attachment and legacy link separately, or use orca reference add for multiple native references.`
    )
  }
}
