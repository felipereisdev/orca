import { forgetUnattachedProvision } from './unattached-provisions'
import {
  listEphemeralVmRuntimes,
  updateEphemeralVmRuntimeStatus
} from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'

export function attachEphemeralVmRuntimeToWorkspace(args: {
  userDataPath: string
  runtimeId: string
  workspaceId: string
}): EphemeralVmRuntimeRecord {
  const runtime = listEphemeralVmRuntimes(args.userDataPath).find(
    (entry) => entry.id === args.runtimeId
  )
  if (!runtime) {
    throw new Error(`Unknown ephemeral VM runtime: ${args.runtimeId}`)
  }
  if (!runtime.recipeResult) {
    // Write-ahead rows have no VM details to attach; they must stay destroyable as they are.
    throw new Error(`Ephemeral VM runtime never finished provisioning: ${args.runtimeId}`)
  }
  if (['cleanup_pending', 'cleanup_failed', 'cleaned'].includes(runtime.status)) {
    throw new Error(`Cannot attach cleaned ephemeral VM runtime: ${args.runtimeId}`)
  }
  const attached = updateEphemeralVmRuntimeStatus(args.userDataPath, args.runtimeId, {
    status: 'running',
    workspaceId: args.workspaceId
  })
  // Only once the workspace is recorded: a failed write must leave the rollback possible.
  forgetUnattachedProvision(args.runtimeId)
  return attached
}
