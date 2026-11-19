import {
  isRuntimeOwnedSshTargetId,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import { composeWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { reviewRecipeRemoval } from './recipe-removal-preflights'
import { refreshRuntimeEnvironmentCatalog } from '@/runtime/rpc/environment-revisions/runtime-environment-pairing-refresh'

/** Destroy runtimes for removed workspaces and runtime-owned SSH targets. Share with project removal because SSH-mode main worktrees delete through that path; classify targets so callers purge only confirmed destruction. */
export type EphemeralVmCleanupSummary = {
  destroyedSshTargetIds: string[]
  retainedSshTargetIds: string[]
  /** The user cancelled the review: nothing was destroyed. */
  cancelled?: boolean
}

export async function cleanupEphemeralVmRuntimesForDeleted(args: {
  workspaceIds?: readonly string[]
  /** Workspace owners whose same-id siblings on other hosts must survive. */
  hostScopedWorkspaces?: readonly {
    workspaceId: string
    executionHostId: ExecutionHostId
  }[]
  // Also destroy runtimes pinned to these raw SSH target IDs even without a matching workspace.
  runtimeOwnedSshTargetIds?: readonly string[]
  /**
   * Check (and review) each matched runtime by its own record before destroying it, for removals
   * that never deleted a checkout. Otherwise main destroys only what a removal claimed.
   */
  review?: boolean
}): Promise<EphemeralVmCleanupSummary> {
  const destroyedSshTargetIds = new Set<string>()
  const retainedSshTargetIds = new Set<string>()
  try {
    const workspaceIdSet = new Set(args.workspaceIds ?? [])
    const sshTargetIdSet = new Set(
      (args.runtimeOwnedSshTargetIds ?? []).filter((id) => isRuntimeOwnedSshTargetId(id))
    )
    const hostScopedWorkspaceIdentities = new Set(
      (args.hostScopedWorkspaces ?? []).map((target) =>
        composeWorktreeHostIdentity(target.executionHostId, target.workspaceId)
      )
    )
    const runtimes = await window.api.ephemeralVm.listRuntimes()
    const matchingRuntimes = runtimes.filter(
      (runtime) =>
        (runtime.cleanupStatus !== 'succeeded' || runtime.sshTargetId !== undefined) &&
        ((runtime.workspaceId !== undefined && workspaceIdSet.has(runtime.workspaceId)) ||
          (runtime.workspaceId !== undefined &&
            ((runtime.runtimeEnvironmentId !== undefined &&
              hostScopedWorkspaceIdentities.has(
                composeWorktreeHostIdentity(
                  toRuntimeExecutionHostId(runtime.runtimeEnvironmentId),
                  runtime.workspaceId
                )
              )) ||
              (runtime.sshTargetId !== undefined &&
                hostScopedWorkspaceIdentities.has(
                  composeWorktreeHostIdentity(
                    toSshExecutionHostId(runtime.sshTargetId),
                    runtime.workspaceId
                  )
                )))) ||
          (runtime.sshTargetId !== undefined && sshTargetIdSet.has(runtime.sshTargetId)))
    )
    // Main lists these records itself, so an empty workspace list never skips a check.
    const acks = args.review
      ? await reviewRecipeRemoval(
          matchingRuntimes.map((runtime) => ({
            key: runtime.id,
            request: { runtimeId: runtime.id },
            displayName: runtime.workspaceName ?? runtime.recipe?.name ?? runtime.id
          }))
        )
      : new Map<string, string>()
    if (!acks) {
      return { destroyedSshTargetIds: [], retainedSshTargetIds: [], cancelled: true }
    }
    let releasedServer = false
    for (const runtime of matchingRuntimes) {
      try {
        // Main destroys a workspace's environment only with a reviewed ack or a removal's claim.
        const cleaned = await window.api.ephemeralVm.cleanup({
          runtimeId: runtime.id,
          ack: acks.get(runtime.id) ?? ''
        })
        releasedServer ||=
          runtime.runtimeEnvironmentId !== undefined || runtime.sshTargetId !== undefined
        if (runtime.sshTargetId) {
          const targetIds = cleaned.sshTargetId ? retainedSshTargetIds : destroyedSshTargetIds
          targetIds.add(runtime.sshTargetId)
        }
      } catch (error) {
        console.error('Failed to clean up ephemeral VM runtime for deleted workspace:', error)
        if (runtime.sshTargetId) {
          retainedSshTargetIds.add(runtime.sshTargetId)
        }
      }
    }
    if (releasedServer) {
      // Cleanup can forget the VM's server; purge its rows now instead of on the next catalog read.
      await refreshRuntimeEnvironmentCatalog()
    }
  } catch (error) {
    console.error('Failed to clean up ephemeral VM runtime for deleted workspace:', error)
    for (const targetId of args.runtimeOwnedSshTargetIds ?? []) {
      if (isRuntimeOwnedSshTargetId(targetId)) {
        retainedSshTargetIds.add(targetId)
      }
    }
  }
  return {
    destroyedSshTargetIds: [...destroyedSshTargetIds],
    retainedSshTargetIds: [...retainedSshTargetIds]
  }
}
