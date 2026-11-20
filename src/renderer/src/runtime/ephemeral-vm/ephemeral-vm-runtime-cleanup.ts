import {
  isRuntimeOwnedSshTargetId,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'
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
    // Main matches the records by what the removal names; the renderer filters nothing.
    const matchingRuntimes = await window.api.ephemeralVm.listRuntimes({
      workspaceIds: args.workspaceIds ?? [],
      hostScopedWorkspaces: args.hostScopedWorkspaces ?? [],
      runtimeOwnedSshTargetIds: args.runtimeOwnedSshTargetIds ?? []
    })
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
