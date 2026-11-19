import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { desktopControllerToken } from './desktop-sync-registry'

const FENCE_TIMEOUT_MS = 5_000

/**
 * A removal holds its environment now: no new recording may start there and be lost with it. The
 * broker drops the fence after 10 minutes or on the next configure. Best effort: an environment
 * that can't be reached records nothing either.
 */
export async function fenceEnvironmentRecordings(environmentId: string): Promise<void> {
  const controllerToken = desktopControllerToken(environmentId)
  if (!controllerToken) {
    return
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
  } catch {
    console.warn('[ephemeral-vm] recording fence unreachable', { environmentId })
  }
}
