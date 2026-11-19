import { app, ipcMain } from 'electron'
import { z } from 'zod'
import {
  RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
  type RecipeRemovalCheckResult,
  type RecipeRemovalCopyResult,
  type RecipeRemovalPreflight,
  type RecipeRemovalPreflightReason
} from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { readEphemeralVmRuntimesAsync } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store-read'
import { findEphemeralVmWorkspaceOwner } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-workspace-owner'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { runtimeDesktop, type DesktopSettingsSource } from './desktop-configure'
import { isRecordingCopiedOnMac } from './desktop-recording-copies'
import { keepRecordingOnMac } from './desktop-recording-sync'
import { issueRecipeRemovalAck, type RecipeRemovalAckBinding } from './recipe-removal-acks'
import {
  copyRecordingsBeforeRemoval,
  preflightRecipeWorkspaceRemoval,
  type CopyBeforeRemovalPorts,
  type RemovalPreflightTarget
} from './workspace-removal-preflight'

const RemovalTarget = z.object({ hostId: z.string().min(1), workspaceId: z.string().min(1) })

type Resolved =
  | { kind: 'target'; target: RemovalPreflightTarget; binding: RecipeRemovalAckBinding }
  /** An owner exists but nothing on it can be vouched for. */
  | { kind: 'unchecked'; reason: RecipeRemovalPreflightReason; binding?: RecipeRemovalAckBinding }

/**
 * The recipe runtime that owns the workspace on exactly this host, read from the host's own store
 * without blocking the main thread. Null when no recipe owns it or the experiment is off.
 */
async function resolveTarget(
  store: DesktopSettingsSource,
  userDataPath: string,
  value: unknown
): Promise<Resolved | null> {
  const requested = RemovalTarget.safeParse(value).data
  if (store.getSettings().experimentalEphemeralVms !== true || !requested) {
    return null
  }
  const { runtimes, complete } = await readEphemeralVmRuntimesAsync(userDataPath)
  let owner
  try {
    owner = findEphemeralVmWorkspaceOwner(
      runtimes.filter((runtime) => runtime.status !== 'cleaned'),
      requested.workspaceId,
      requested.hostId
    )
  } catch {
    return { kind: 'unchecked', reason: 'ambiguous' }
  }
  if (!owner) {
    return null
  }
  const binding = {
    hostId: requested.hostId,
    workspaceId: requested.workspaceId,
    runtimeId: owner.id,
    runtimeCreatedAt: owner.createdAt
  }
  if (!owner.runtimeEnvironmentId) {
    return { kind: 'unchecked', reason: 'no_orca_server', binding }
  }
  // Without the feature store the record may have lost its desktop; never read that as none.
  if (!complete) {
    return { kind: 'unchecked', reason: 'store_unreadable', binding }
  }
  return {
    kind: 'target',
    binding,
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

function withAck(
  preflight: RecipeRemovalPreflight,
  binding: RecipeRemovalAckBinding | undefined
): RecipeRemovalCheckResult {
  // An answer with no single owner can't be bound; its empty ack never lets a destroy through.
  return { ...preflight, ack: binding ? issueRecipeRemovalAck(binding) : '' }
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
  const resolved = await resolveTarget(store, userDataPath, request)
  if (!resolved) {
    return null
  }
  if (resolved.kind === 'unchecked') {
    return withAck(unchecked(resolved.reason), resolved.binding)
  }
  const preflight = await preflightRecipeWorkspaceRemoval(resolved.target, ports(resolved.target))
  return withAck(preflight, resolved.binding)
}

/** Copies the pending recordings; only a proven-complete copy answers with an ack to remove. */
export async function copyRecipeRecordingsBeforeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  request: unknown
): Promise<RecipeRemovalCopyResult> {
  const resolved = await resolveTarget(store, userDataPath, request)
  if (resolved?.kind !== 'target') {
    return { ok: false, reason: 'unavailable' }
  }
  const outcome = await copyRecordingsBeforeRemoval(resolved.target, ports(resolved.target))
  if (outcome.ok) {
    return { ...outcome, ack: issueRecipeRemovalAck(resolved.binding) }
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
}
