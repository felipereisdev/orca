import { randomUUID } from 'node:crypto'
import { DESKTOP_RECORDING_FENCE_MS } from '../desktop/desktop-recording-fences'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { desktopControllerToken } from './desktop-sync-registry'
import type { RemovalRecordingFence } from './recipe-removal-acks'

const FENCE_TIMEOUT_MS = 5_000

export function createRemovalRecordingFence(environmentId: string): RemovalRecordingFence {
  const fenceId = randomUUID()
  let holding: Promise<boolean> | undefined
  let releasing: Promise<void> | undefined
  let deadline = 0

  async function update(method: 'desktop.record.fence' | 'desktop.record.unfence') {
    try {
      const controllerToken = desktopControllerToken(environmentId)
      if (controllerToken) {
        if (method === 'desktop.record.fence') {
          deadline = performance.now() + FENCE_TIMEOUT_MS + DESKTOP_RECORDING_FENCE_MS
        }
        const response = await callRuntimeEnvironment(
          getRuntimeEnvironmentRegistryRoot(),
          environmentId,
          method,
          { controllerToken, fenceId },
          FENCE_TIMEOUT_MS
        )
        if (response.ok) {
          return true
        }
      }
    } catch {
      // A lost reply can leave the fence installed until its lease expires.
    }
    console.warn('[ephemeral-vm] recording fence RPC failed', { environmentId, method })
    return false
  }

  return {
    hold: () => {
      if (releasing) {
        return Promise.resolve(false)
      }
      holding ??= update('desktop.record.fence').finally(() => {
        holding = undefined
      })
      return holding
    },
    release: () =>
      (releasing ??= (async () => {
        await holding
        if (deadline > performance.now()) {
          await update('desktop.record.unfence')
        }
      })()),
    mayBeHeld: () => deadline > performance.now()
  }
}
