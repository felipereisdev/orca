import type { Repo } from '../../shared/repo-types'
import type { TaskStartResult } from '../../shared/task-board/task-board-wire-types'
import type { RemoteTrackingBase } from '../runtime/repositories/runtime-remote-fetch-controller'
import type { TaskStartCard } from './task-start-context'
import type { TaskStartOptionsDeps } from './task-start-options'
import type { TaskStartRunGuard } from './task-start-service-guard'

export type TaskStartWorkspaceDeps = {
  options: Pick<TaskStartOptionsDeps, 'baseRefDefault'>
  primaryWorktreeId(repo: Repo): Promise<string>
  /** The base's remote-tracking branch, or null when the base has no remote. */
  remoteBase(repo: Repo, base: string): Promise<RemoteTrackingBase | null>
  /** Fetches the base's branch from its remote; throws when the fetch fails. */
  fetchBase(repo: Repo, base: RemoteTrackingBase): Promise<void>
  /** Switches the primary checkout to a new branch at `startPoint`, named as the card's worktree branch. */
  createPrimaryBranch(args: {
    repo: Repo
    worktreeId: string
    card: TaskStartCard
    startPoint: string
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

/** Fetches a remote base and returns its fresh remote ref; a local-only base is used as is. */
async function updateTaskStartBase(
  repo: Repo,
  base: string,
  deps: TaskStartWorkspaceDeps
): Promise<string> {
  const remote = await deps.remoteBase(repo, base)
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
      return guard.fail('worktree-create-failed', 'base_update_failed')
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
  try {
    if (!startPoint) {
      throw new Error('No base branch to start the task branch from')
    }
    await deps.createPrimaryBranch({ repo, worktreeId, card, startPoint })
  } catch (error) {
    console.warn('[task-start] creating the task branch in the primary checkout failed', error)
    return guard.fail('worktree-create-failed', 'primary_branch_failed')
  }
  return { worktreeId }
}
