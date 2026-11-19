import type { EphemeralVmRuntimeRecord } from '../../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import { recipeRuntimeHostIds, takeRecipeRemovalAck } from './recipe-removal-ack-registry'
import { runRecipeRemovalPreflights } from './recipe-removal-preflights'

/**
 * Destroys the environment of a workspace whose create failed or was cancelled. Nothing was ever
 * done in it, so there is nothing to review: the removal check runs only to obtain the ack main
 * requires once the runtime was attached to the workspace.
 */
export async function cleanupFailedCreateRuntime(
  runtimeId: string
): Promise<EphemeralVmRuntimeRecord> {
  const runtime = (await window.api.ephemeralVm.listRuntimes()).find(
    (entry) => entry.id === runtimeId
  )
  const hostIds = runtime ? recipeRuntimeHostIds(runtime) : []
  if (runtime?.workspaceId && hostIds.length > 0) {
    await runRecipeRemovalPreflights(
      hostIds.map((hostId) => ({ id: runtime.workspaceId ?? '', hostId, displayName: '' }))
    )
  }
  return window.api.ephemeralVm.cleanup({
    runtimeId,
    ack: takeRecipeRemovalAck(hostIds, runtime?.workspaceId)
  })
}
