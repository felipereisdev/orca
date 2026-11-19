import { app, ipcMain } from 'electron'
import { z } from 'zod'
import {
  RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
  type RecipeRemovalCopyResult,
  type RecipeRemovalPreflight
} from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { listEphemeralVmRuntimesAsync } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store-read'
import { findEphemeralVmWorkspaceOwner } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-workspace-owner'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { runtimeDesktop, type DesktopSettingsSource } from './desktop-configure'
import { isRecordingCopiedOnMac } from './desktop-recording-copies'
import { keepRecordingOnMac } from './desktop-recording-sync'
import {
  copyRecordingsBeforeRemoval,
  preflightRecipeWorkspaceRemoval,
  type CopyBeforeRemovalPorts,
  type RemovalPreflightTarget
} from './workspace-removal-preflight'

const RemovalTarget = z.object({ hostId: z.string().min(1), workspaceId: z.string().min(1) })

export type ResolvedRemovalTarget =
  | { kind: 'target'; target: RemovalPreflightTarget }
  /** Several recipe runtimes claim the workspace on this host; nothing can be vouched for. */
  | { kind: 'ambiguous' }
  /** Not a recipe workspace with an Orca to ask, or the experiment is off. */
  | null

/**
 * The recipe runtime that owns the workspace on exactly this host, read from the host's own store
 * without blocking the main thread; a workspace id alone can name checkouts on several hosts.
 */
export async function resolveRecipeRemovalTarget(
  store: DesktopSettingsSource,
  userDataPath: string,
  value: unknown
): Promise<ResolvedRemovalTarget> {
  const requested = RemovalTarget.safeParse(value).data
  if (store.getSettings().experimentalEphemeralVms !== true || !requested) {
    return null
  }
  const runtimes = (await listEphemeralVmRuntimesAsync(userDataPath)).filter(
    (runtime) => runtime.status !== 'cleaned'
  )
  let owner
  try {
    owner = findEphemeralVmWorkspaceOwner(runtimes, requested.workspaceId, requested.hostId)
  } catch {
    return { kind: 'ambiguous' }
  }
  if (!owner?.runtimeEnvironmentId) {
    return null
  }
  return {
    kind: 'target',
    target: {
      runtimeId: owner.id,
      environmentId: owner.runtimeEnvironmentId,
      workspaceId: requested.workspaceId,
      hasDesktop: runtimeDesktop(store, owner) !== null,
      asleep: owner.status === 'suspended'
    }
  }
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
    isCopied: isRecordingCopiedOnMac,
    copy: (recording, signal) =>
      keepRecordingOnMac({
        environmentId: target.environmentId,
        workspaceId: target.workspaceId,
        recording,
        signal
      })
  }
}

const AMBIGUOUS: RecipeRemovalPreflight = {
  status: 'unchecked',
  recordingsNotCopied: [],
  dirtyFiles: 0,
  unpushedCommits: 0,
  reason: 'ambiguous'
}

/** The desktop asks here before removing a recipe workspace; null keeps today's dialog. */
export function registerRecipeRemovalPreflightHandlers(store: DesktopSettingsSource): void {
  ipcMain.removeHandler('ephemeralVm:removalPreflight')
  ipcMain.removeHandler('ephemeralVm:copyRecordingsBeforeRemoval')
  ipcMain.handle(
    'ephemeralVm:removalPreflight',
    async (_event, args: unknown): Promise<RecipeRemovalPreflight | null> => {
      const resolved = await resolveRecipeRemovalTarget(store, app.getPath('userData'), args)
      if (resolved?.kind === 'ambiguous') {
        return AMBIGUOUS
      }
      return resolved
        ? preflightRecipeWorkspaceRemoval(resolved.target, ports(resolved.target))
        : null
    }
  )
  ipcMain.handle(
    'ephemeralVm:copyRecordingsBeforeRemoval',
    async (_event, args: unknown): Promise<RecipeRemovalCopyResult> => {
      const resolved = await resolveRecipeRemovalTarget(store, app.getPath('userData'), args)
      return resolved?.kind === 'target'
        ? copyRecordingsBeforeRemoval(resolved.target, ports(resolved.target))
        : { ok: false, reason: 'unavailable' }
    }
  )
}
