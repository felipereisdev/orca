import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { desktopControllerToken } from './desktop-sync-registry'

const FENCE_TIMEOUT_MS = 5_000

/**
 * A removal is about to list the environment's recordings: no new one may start there and be lost
 * with it. The broker drops the fence after 10 minutes or on the next configure. False when the
 * environment could not be fenced (no controller token, refused or unreachable).
 */
export async function fenceEnvironmentRecordings(environmentId: string): Promise<boolean> {
  const controllerToken = desktopControllerToken(environmentId)
  if (!controllerToken) {
    return false
  }
  try {
    const response = await callRuntimeEnvironment(
      getRuntimeEnvironmentRegistryRoot(),
      environmentId,
      'desktop.record.fence',
      { controllerToken },
      FENCE_TIMEOUT_MS
    )
    if (!response.ok) {
      console.warn('[ephemeral-vm] recording fence refused', { environmentId })
    }
    return response.ok
  } catch {
    console.warn('[ephemeral-vm] recording fence unreachable', { environmentId })
    return false
  }
}
