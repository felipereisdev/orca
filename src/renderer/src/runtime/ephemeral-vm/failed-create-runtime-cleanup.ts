import type { EphemeralVmRuntimeRecord } from '../../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'

/**
 * Destroys the environment of a workspace whose create failed or was cancelled. Main issues the
 * rollback ack only for a record it knows never held a workspace; anything else is refused and
 * stays in Cloud VMs, where its cleanup is reviewed.
 */
export async function cleanupFailedCreateRuntime(
  runtimeId: string
): Promise<EphemeralVmRuntimeRecord> {
  const ack = await window.api.ephemeralVm.rollbackRemovalAck({ runtimeId })
  return window.api.ephemeralVm.cleanup({ runtimeId, ack })
}
