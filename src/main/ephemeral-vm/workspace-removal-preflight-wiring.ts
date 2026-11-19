import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
  type RecipeRemovalCopyResult,
  type RecipeRemovalPreflight
} from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import type { DesktopSettingsSource } from './desktop-configure'
import { isCopiedRecordingKnown } from './desktop-recording-copies'
import { keepRecordingOnMac } from './desktop-recording-sync'
import { stopEnvironmentDesktop } from './desktop-sync-registry'
import {
  copyRecordingsBeforeRemoval,
  preflightRecipeWorkspaceRemoval,
  type CopyBeforeRemovalPorts,
  type RemovalPreflightTarget
} from './workspace-removal-preflight'

const RemovalTarget = z.object({
  runtimeId: z.string().min(1),
  workspaceId: z.string().min(1),
  environmentId: z.string().min(1),
  hasDesktop: z.boolean(),
  asleep: z.boolean()
})

/**
 * The runtime the desktop's own runtime list names for this workspace; the renderer reads it from
 * `listRuntimes`, so this never reads the runtime store on the main thread. Null when the check is off.
 */
function resolveTarget(
  store: DesktopSettingsSource,
  value: unknown
): RemovalPreflightTarget | null {
  const requested = RemovalTarget.safeParse(value).data
  if (store.getSettings().experimentalEphemeralVms !== true || !requested) {
    return null
  }
  return requested
}

function ports(target: RemovalPreflightTarget): CopyBeforeRemovalPorts {
  return {
    call: (environmentId, method, params, signal) =>
      callRuntimeEnvironment(
        getRuntimeEnvironmentRegistryRoot(),
        `id:${environmentId}`,
        method,
        params,
        RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
        undefined,
        undefined,
        { signal }
      ),
    isCopied: isCopiedRecordingKnown,
    copy: (recording, signal) =>
      keepRecordingOnMac({
        environmentId: target.environmentId,
        workspaceId: target.workspaceId,
        recording,
        signal
      }),
    stopDesktop: stopEnvironmentDesktop
  }
}

/** The desktop asks here before removing a recipe workspace; null keeps today's dialog. */
export function registerRecipeRemovalPreflightHandlers(store: DesktopSettingsSource): void {
  ipcMain.removeHandler('ephemeralVm:removalPreflight')
  ipcMain.removeHandler('ephemeralVm:copyRecordingsBeforeRemoval')
  ipcMain.handle(
    'ephemeralVm:removalPreflight',
    async (_event, args: unknown): Promise<RecipeRemovalPreflight | null> => {
      const target = resolveTarget(store, args)
      return target ? preflightRecipeWorkspaceRemoval(target, ports(target)) : null
    }
  )
  ipcMain.handle(
    'ephemeralVm:copyRecordingsBeforeRemoval',
    async (_event, args: unknown): Promise<RecipeRemovalCopyResult> => {
      const target = resolveTarget(store, args)
      return target
        ? copyRecordingsBeforeRemoval(target, ports(target))
        : { ok: false, reason: 'unavailable' }
    }
  )
}
