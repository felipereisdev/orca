import {
  isRuntimeOwnedSshTargetId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { AppState } from '../types'
import { cleanupEphemeralVmRuntimesForDeleted } from '@/runtime/ephemeral-vm/ephemeral-vm-runtime-cleanup'
import { getRecipeVmSshTargetForHost } from '@/runtime/ephemeral-vm/recipe-vm-managed-host'
import { selectWorktreesByRepo } from '../workspaces/catalog/workspace-record-fields'
import { getIndexedAllWorktrees } from '../slices/worktrees/listing/worktree-catalog-index'
import {
  confirmRecipeRemoval,
  type RecipeRemovalCandidate
} from '@/runtime/ephemeral-vm/recipe-removal-preflights'

/** The user cancelled after seeing what destroying the project's VM would lose. */
export class RecipeRemovalCancelledError extends Error {
  constructor() {
    super('Project removal was cancelled.')
    this.name = 'RecipeRemovalCancelledError'
  }
}

function recipeRemovalTargets(
  state: Pick<AppState, 'worktreesByRepo'>,
  ownerHostId: ExecutionHostId,
  workspaceIds: readonly string[]
): RecipeRemovalCandidate[] {
  const worktrees = getIndexedAllWorktrees(selectWorktreesByRepo(state))
  return workspaceIds.map((id) => ({
    id,
    hostId: ownerHostId,
    displayName: worktrees.find((worktree) => worktree.id === id)?.displayName ?? id
  }))
}

type RecipeVmRemovalTargets = { knownServerTarget: string | null; directTarget: string | null }

/** Return null when removing this project on this host leaves no recipe VM to destroy. */
export function getRecipeVmRemovalTargets(
  state: Pick<AppState, 'runtimeEnvironments' | 'worktreesByRepo'>,
  ownerRepo: Pick<Repo, 'id' | 'connectionId'>,
  ownerHostId: ExecutionHostId
): RecipeVmRemovalTargets | null {
  const knownServerTarget = getRecipeVmSshTargetForHost(state.runtimeEnvironments, ownerHostId)
  const hasProvisionedRoot = (selectWorktreesByRepo(state)[ownerRepo.id] ?? []).some(
    (worktree) =>
      (worktree.hostId ?? LOCAL_EXECUTION_HOST_ID) === ownerHostId &&
      worktree.ephemeralVmCheckoutMode === 'provisioned-root'
  )
  const directTarget =
    ownerRepo.connectionId && isRuntimeOwnedSshTargetId(ownerRepo.connectionId)
      ? ownerRepo.connectionId
      : null
  if (!knownServerTarget && !hasProvisionedRoot && !directTarget) {
    return null
  }
  return { knownServerTarget, directTarget }
}

/** Destroy backing recipe VM before project removal to prevent leaks. Return false synchronously without a VM; resolve true if VM destruction also removed the owning managed server/catalog. */
export function destroyRecipeVmBeforeProjectRemoval(
  state: Pick<AppState, 'runtimeEnvironments' | 'worktreesByRepo' | 'settings'>,
  ownerRepo: Pick<Repo, 'id' | 'connectionId'>,
  ownerHostId: ExecutionHostId,
  workspaceIds: string[]
): Promise<boolean> | false {
  const targets = getRecipeVmRemovalTargets(state, ownerRepo, ownerHostId)
  if (!targets) {
    return false
  }
  return destroyRecipeVm(
    state,
    ownerHostId,
    workspaceIds,
    targets.knownServerTarget,
    targets.directTarget
  )
}

async function destroyRecipeVm(
  state: Pick<AppState, 'worktreesByRepo' | 'settings'>,
  ownerHostId: ExecutionHostId,
  workspaceIds: string[],
  knownServerTarget: string | null,
  directTarget: string | null
): Promise<boolean> {
  const serverTarget =
    knownServerTarget ??
    // Why: the renderer's catalog may predate the server the VM's first connect deployed.
    (ownerHostId.startsWith('runtime:')
      ? getRecipeVmSshTargetForHost(await window.api.runtimeEnvironments.list(), ownerHostId)
      : null)
  const targetId = serverTarget ?? directTarget
  if (!targetId) {
    return false
  }
  // Destroying the VM loses everything on it; its workspaces are checked (and reviewed) first.
  if (
    !(await confirmRecipeRemoval(state, recipeRemovalTargets(state, ownerHostId, workspaceIds)))
  ) {
    throw new RecipeRemovalCancelledError()
  }
  // Why host-scoped: another VM's server can publish the same raw workspace id.
  const cleanup = await cleanupEphemeralVmRuntimesForDeleted({
    hostScopedWorkspaces: workspaceIds.map((workspaceId) => ({
      workspaceId,
      executionHostId: ownerHostId
    })),
    runtimeOwnedSshTargetIds: [targetId]
  })
  if (cleanup.retainedSshTargetIds.includes(targetId)) {
    throw new Error('The cloud VM could not be destroyed. Retry cleanup before removing it.')
  }
  return serverTarget !== null
}
