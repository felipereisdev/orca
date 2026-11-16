import type { Repo } from '../../shared/repository/repo-types'
import type { TaskStartResult } from '../../shared/task-board/task-board-wire-types'
import { ExecutionHostNotDispatchableError } from '../providers/execution-host-provider-dispatch'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import type { RemoteTrackingBase } from '../runtime/repositories/runtime-remote-fetch-controller'
import type { TaskStartCard } from './task-start-context'
import type { TaskStartOptionsDeps } from './task-start-options'
import type { TaskStartRunGuard } from './task-start-service-guard'

export type TaskStartWorkspaceDeps = {
  options: Pick<TaskStartOptionsDeps, 'baseRefDefault'>
  primaryWorktreeId(repo: Repo): Promise<string>
  /** The base's remote-tracking branch, or null when the base has no remote. */
  remoteBase(repo: Repo, base: string): Promise<RemoteTrackingBase | null>
  /** A local base branch's upstream on a remote, or null when it tracks none. */
  baseUpstream(repo: Repo, base: string): Promise<RemoteTrackingBase | null>
  /** Fetches the base's branch from its remote; throws when the fetch fails. */
  fetchBase(repo: Repo, base: RemoteTrackingBase): Promise<void>
  /** Switches the primary checkout to a new branch at `startPoint` (HEAD when absent), named as the card's worktree branch. */
  createPrimaryBranch(args: {
    repo: Repo
    worktreeId: string
    card: TaskStartCard
    startPoint?: string
  }): Promise<void>
  /** A new worktree with the card's item linked. */
  createWorktree(args: {
    repo: Repo
    card: TaskStartCard
    baseBranch?: string
  }): Promise<{ worktreeId: string }>
}

/** The start's base: the dialog's, the repo's, else the repo's default. */
export async function resolveTaskStartBase(
  repo: Repo,
  baseRef: string | undefined,
  deps: TaskStartWorkspaceDeps
): Promise<string | null> {
  return (
    baseRef ?? repo.worktreeBaseRef ?? (await deps.options.baseRefDefault(repo).catch(() => null))
  )
}

/** Fetches a remote base, or a local base's upstream, and returns the fresh remote ref
 *  (a local base's unpushed commits are left out); a base with no remote is used as is. */
async function updateTaskStartBase(
  repo: Repo,
  base: string,
  deps: TaskStartWorkspaceDeps
): Promise<string> {
  const remote = (await deps.remoteBase(repo, base)) ?? (await deps.baseUpstream(repo, base))
  if (!remote) {
    return base
  }
  await deps.fetchBase(repo, remote)
  return remote.base
}

/** The run's workspace, started at the base's remote tip: a new worktree, or the primary
 *  checkout switched to the card's branch (folder repos: as is). */
export async function openTaskStartWorkspace(
  prepared: {
    repo: Repo
    workspaceMode: 'worktree' | 'primary'
    base: string | null
    primaryWorktreeId?: string
  },
  card: TaskStartCard,
  guard: TaskStartRunGuard,
  deps: TaskStartWorkspaceDeps
): Promise<{ worktreeId: string } | TaskStartResult> {
  const { repo } = prepared
  let startPoint: string | null = null
  if (prepared.base) {
    try {
      startPoint = await updateTaskStartBase(repo, prepared.base, deps)
    } catch (error) {
      console.warn('[task-start] updating the base from its remote failed', error)
      // This process cannot run the repo's git at all: not a connection problem to report.
      const unreachable =
        error instanceof SshHostNotServedError || error instanceof ExecutionHostNotDispatchableError
      return guard.fail(
        'worktree-create-failed',
        unreachable ? 'worktree_create_failed' : 'base_update_failed'
      )
    }
    if (!guard.alive()) {
      return guard.settle()
    }
  }
  if (prepared.workspaceMode === 'worktree') {
    try {
      const created = await deps.createWorktree({
        repo,
        card,
        ...(startPoint ? { baseBranch: startPoint } : {})
      })
      return { worktreeId: created.worktreeId }
    } catch (error) {
      console.warn('[task-start] preparing the workspace failed', error)
      return guard.fail('worktree-create-failed', 'worktree_create_failed')
    }
  }
  let worktreeId: string
  try {
    worktreeId = prepared.primaryWorktreeId ?? (await deps.primaryWorktreeId(repo))
  } catch (error) {
    console.warn('[task-start] preparing the workspace failed', error)
    return guard.fail('worktree-create-failed', 'worktree_create_failed')
  }
  // Folder repos never consult git.
  if (repo.kind === 'folder') {
    return { worktreeId }
  }
  if (!startPoint) {
    console.warn('[task-start] no base branch resolved; the task branch starts at HEAD')
  }
  try {
    await deps.createPrimaryBranch({
      repo,
      worktreeId,
      card,
      ...(startPoint ? { startPoint } : {})
    })
  } catch (error) {
    console.warn('[task-start] creating the task branch in the primary checkout failed', error)
    return guard.fail('worktree-create-failed', 'primary_branch_failed')
  }
  return { worktreeId }
}
