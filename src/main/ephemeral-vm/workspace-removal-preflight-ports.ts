import { RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { isRecordingCopiedOnMac } from './desktop-recording-copies'
import { keepRecordingOnMac } from './desktop-recording-sync'
import type { RemovalRecordingFence } from './recipe-removal-acks'
import type { CopyBeforeRemovalPorts, RemovalPreflightTarget } from './workspace-removal-preflight'

/** The environment's Orca and this Mac's recording copies, as a removal check reaches them. */
export function removalPreflightPorts(
  target: RemovalPreflightTarget,
  fence: RemovalRecordingFence
): CopyBeforeRemovalPorts {
  return {
    call: (environmentId, method, params, signal, timeoutMs) =>
      callRuntimeEnvironment(
        getRuntimeEnvironmentRegistryRoot(),
        `id:${environmentId}`,
        method,
        params,
        timeoutMs ?? RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
        undefined,
        undefined,
        { signal }
      ),
    isCopied: isRecordingCopiedOnMac,
    fence: fence.hold,
    copy: (recording, signal) =>
      keepRecordingOnMac({
        environmentId: target.environmentId,
        workspaceId: target.workspaceId,
        recording,
        signal
      })
  }
}
