import { app, ipcMain } from 'electron'
import { z } from 'zod'
import type { RecipeRemovalClaimResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { readEphemeralVmRuntimesAsync } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store-read'
import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../shared/execution-host/execution-host'
import type { DesktopSettingsSource } from './desktop-configure'
import { createRemovalRecordingFence } from './desktop-recording-fence'
import {
  adoptRecipeRemovalClaim,
  claimRecipeRemovalAck,
  confirmRecipeRemovalAck,
  issueRecipeRemovalAck,
  peekRecipeRemovalAck,
  releaseRecipeRemovalClaim,
  revokeRecipeRemovalAck,
  revokeRecipeRemovalSession,
  type RecipeRemovalAckBinding
} from './recipe-removal-acks'
import { currentRecipeOwner, resolveRecipeRemoval } from './recipe-removal-target'
import { recordingsAllowClaim } from './recipe-removal-recording-guard'
import { removalPreflightPorts } from './workspace-removal-preflight-ports'
import { isUnattachedProvision } from './unattached-provisions'

const AckArgs = z.object({ ack: z.string() })
const ClaimArgs = z.object({
  ack: z.string(),
  hostId: z.string().min(1),
  workspaceId: z.string().min(1)
})
const ReleaseArgs = ClaimArgs.omit({ ack: true })
const AdoptArgs = ReleaseArgs.extend({ sessionId: z.string().min(1).optional() })
const SessionArgs = z.object({ sessionId: z.string().min(1) })

type CurrentBinding = RecipeRemovalAckBinding & { environmentId?: string }

/** The record owning the workspace now, as an ack binding; null when no recipe holds it. */
async function currentBinding(
  store: DesktopSettingsSource,
  userDataPath: string,
  hostId: string,
  workspaceId: string
): Promise<CurrentBinding | null | 'ambiguous'> {
  if (store.getSettings().experimentalEphemeralVms !== true) {
    return null
  }
  const owner = await currentRecipeOwner(userDataPath, hostId, workspaceId)
  if (!owner || owner === 'ambiguous') {
    return owner
  }
  return {
    hostId,
    workspaceId: owner.workspaceId ?? '',
    runtimeId: owner.id,
    runtimeCreatedAt: owner.createdAt,
    ...(owner.runtimeEnvironmentId ? { environmentId: owner.runtimeEnvironmentId } : {})
  }
}

function ackBinding({ environmentId: _environmentId, ...binding }: CurrentBinding) {
  return binding
}
const RollbackArgs = z.object({ runtimeId: z.string().min(1) })

/** Holds the workspace's environment for the removal that is about to delete its checkout. */
export async function claimRecipeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  value: unknown
): Promise<RecipeRemovalClaimResult> {
  const args = ClaimArgs.parse(value)
  const binding = await currentBinding(store, userDataPath, args.hostId, args.workspaceId)
  if (binding === 'ambiguous') {
    return { ok: false, reason: 'replaced' }
  }
  if (!binding) {
    return { ok: true, required: false }
  }
  const resolved = await resolveRecipeRemoval(store, userDataPath, args)
  const decided = peekRecipeRemovalAck(
    args.ack,
    ackBinding(binding),
    resolved?.kind === 'target'
      ? createRemovalRecordingFence(resolved.target.environmentId)
      : undefined
  )
  if (!decided.ok) {
    return decided
  }
  const kept =
    resolved?.kind === 'target' && decided.fence
      ? await recordingsAllowClaim(
          resolved.target,
          decided.accepted,
          removalPreflightPorts(resolved.target, decided.fence)
        )
      : decided.accepted === 'unknown'
  if (!kept) {
    // The answer no longer holds: the user must see a fresh one.
    await revokeRecipeRemovalAck(args.ack)
    return { ok: false, reason: 'recordings_unprotected' }
  }
  const claim = claimRecipeRemovalAck(args.ack, ackBinding(binding))
  return claim.ok ? { ok: true, required: true } : claim
}

/** At the store removal: takes over the claim its dialog session (or its own flow) made. */
export async function adoptRecipeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  value: unknown
): Promise<RecipeRemovalClaimResult> {
  const args = AdoptArgs.parse(value)
  const binding = await currentBinding(store, userDataPath, args.hostId, args.workspaceId)
  if (binding === 'ambiguous') {
    return { ok: false, reason: 'replaced' }
  }
  if (!binding) {
    return { ok: true, required: false }
  }
  const adopted = adoptRecipeRemovalClaim(ackBinding(binding), args.sessionId)
  return adopted.ok ? { ok: true, required: true } : adopted
}

/**
 * The ack a failed or cancelled create needs to destroy its VM: only for a record main knows never
 * held a workspace (still provisioning, failed, or provisioned here and never attached).
 */
export async function rollbackRecipeRemovalAck(
  userDataPath: string,
  value: unknown
): Promise<string> {
  const { runtimeId } = RollbackArgs.parse(value)
  const runtime = (await readEphemeralVmRuntimesAsync(userDataPath)).runtimes.find(
    (entry) => entry.id === runtimeId
  )
  const neverAttached =
    runtime !== undefined &&
    runtime.workspaceId === undefined &&
    (runtime.status === 'provisioning' ||
      runtime.status === 'failed' ||
      isUnattachedProvision(runtime.id))
  const hostId = runtime?.runtimeEnvironmentId
    ? toRuntimeExecutionHostId(runtime.runtimeEnvironmentId)
    : runtime?.sshTargetId
      ? toSshExecutionHostId(runtime.sshTargetId)
      : null
  if (!runtime || !neverAttached || !hostId) {
    return ''
  }
  return issueRecipeRemovalAck(
    { hostId, workspaceId: '', runtimeId: runtime.id, runtimeCreatedAt: runtime.createdAt },
    true
  )
}

export function registerRecipeRemovalAckHandlers(store: DesktopSettingsSource): void {
  for (const channel of [
    'ephemeralVm:confirmRemoval',
    'ephemeralVm:revokeRemoval',
    'ephemeralVm:claimRemoval',
    'ephemeralVm:adoptRemoval',
    'ephemeralVm:releaseRemoval',
    'ephemeralVm:revokeRemovalSession',
    'ephemeralVm:rollbackRemovalAck'
  ]) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('ephemeralVm:confirmRemoval', (_event, args: unknown) =>
    confirmRecipeRemovalAck(AckArgs.parse(args).ack)
  )
  ipcMain.handle('ephemeralVm:revokeRemoval', (_event, args: unknown) =>
    revokeRecipeRemovalAck(AckArgs.parse(args).ack)
  )
  ipcMain.handle('ephemeralVm:claimRemoval', (_event, args: unknown) =>
    claimRecipeRemoval(store, app.getPath('userData'), args)
  )
  ipcMain.handle('ephemeralVm:adoptRemoval', (_event, args: unknown) =>
    adoptRecipeRemoval(store, app.getPath('userData'), args)
  )
  ipcMain.handle('ephemeralVm:revokeRemovalSession', (_event, args: unknown) =>
    revokeRecipeRemovalSession(SessionArgs.parse(args).sessionId)
  )
  ipcMain.handle('ephemeralVm:releaseRemoval', (_event, args: unknown) => {
    const { hostId, workspaceId } = ReleaseArgs.parse(args)
    releaseRecipeRemovalClaim(hostId, workspaceId)
  })
  ipcMain.handle('ephemeralVm:rollbackRemovalAck', (_event, args: unknown) =>
    rollbackRecipeRemovalAck(app.getPath('userData'), args)
  )
}
