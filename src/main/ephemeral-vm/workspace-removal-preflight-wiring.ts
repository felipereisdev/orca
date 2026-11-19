import { app, ipcMain } from 'electron'
import {
  RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
  type RecipeRemovalCheckResult,
  type RecipeRemovalCopyResult,
  type RecipeRemovalPreflight,
  type RecipeRemovalPreflightReason
} from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import type { DesktopSettingsSource } from './desktop-configure'
import { isRecordingCopiedOnMac } from './desktop-recording-copies'
import { keepRecordingOnMac } from './desktop-recording-sync'
import { issueRecipeRemovalAck, type RecipeRemovalAckBinding } from './recipe-removal-acks'
import { registerRecipeRemovalAckHandlers } from './recipe-removal-ack-handlers'
import { resolveRecipeRemoval } from './recipe-removal-target'
import {
  copyRecordingsBeforeRemoval,
  preflightRecipeWorkspaceRemoval,
  type CopyBeforeRemovalPorts,
  type RemovalPreflightTarget
} from './workspace-removal-preflight'

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

/**
 * Every answer carries an ack bound to the owner. Only a clean one may be spent at once; an unsafe
 * or unchecked one waits for the user's explicit confirm. No single owner means no usable ack.
 */
function withAck(
  preflight: RecipeRemovalPreflight,
  binding: RecipeRemovalAckBinding | undefined
): RecipeRemovalCheckResult {
  return {
    ...preflight,
    ack: binding ? issueRecipeRemovalAck(binding, preflight.status === 'clean') : ''
  }
}

function unchecked(reason: RecipeRemovalPreflightReason): RecipeRemovalPreflight {
  return { status: 'unchecked', recordingsNotCopied: [], dirtyFiles: 0, unpushedCommits: 0, reason }
}

/** What removing the workspace would lose, with the ack its destroy needs; null when not a recipe. */
export async function checkRecipeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  request: unknown
): Promise<RecipeRemovalCheckResult | null> {
  const resolved = await resolveRecipeRemoval(store, userDataPath, request)
  if (!resolved) {
    return null
  }
  if (resolved.kind === 'unchecked') {
    return withAck(unchecked(resolved.reason), resolved.binding)
  }
  const preflight = await preflightRecipeWorkspaceRemoval(resolved.target, ports(resolved.target))
  return withAck(preflight, resolved.binding)
}

/** Copies the pending recordings; only a proven-complete copy answers with a usable ack. */
export async function copyRecipeRecordingsBeforeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  request: unknown
): Promise<RecipeRemovalCopyResult> {
  const resolved = await resolveRecipeRemoval(store, userDataPath, request)
  if (resolved?.kind !== 'target') {
    return { ok: false, reason: 'unavailable' }
  }
  const outcome = await copyRecordingsBeforeRemoval(resolved.target, ports(resolved.target))
  if (outcome.ok) {
    // The user asked to copy and remove, and a final list proved nothing is pending.
    return { ...outcome, ack: issueRecipeRemovalAck(resolved.binding, true) }
  }
  return outcome.reason === 'still_pending'
    ? { ...outcome, preflight: withAck(outcome.preflight, resolved.binding) }
    : outcome
}

/** The desktop asks here before removing a recipe workspace; null keeps today's dialog. */
export function registerRecipeRemovalPreflightHandlers(store: DesktopSettingsSource): void {
  ipcMain.removeHandler('ephemeralVm:removalPreflight')
  ipcMain.removeHandler('ephemeralVm:copyRecordingsBeforeRemoval')
  ipcMain.handle('ephemeralVm:removalPreflight', (_event, args: unknown) =>
    checkRecipeRemoval(store, app.getPath('userData'), args)
  )
  ipcMain.handle('ephemeralVm:copyRecordingsBeforeRemoval', (_event, args: unknown) =>
    copyRecipeRecordingsBeforeRemoval(store, app.getPath('userData'), args)
  )
  registerRecipeRemovalAckHandlers(store)
}
