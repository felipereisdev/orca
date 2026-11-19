import { app, ipcMain } from 'electron'
import { z } from 'zod'
import type { RecipeRemovalClaimResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { readEphemeralVmRuntimesAsync } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store-read'
import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../shared/execution-host/execution-host'
import type { DesktopSettingsSource } from './desktop-configure'
import {
  claimRecipeRemovalAck,
  confirmRecipeRemovalAck,
  issueRecipeRemovalAck,
  releaseRecipeRemovalClaim,
  revokeRecipeRemovalAck
} from './recipe-removal-acks'
import { currentRecipeOwner } from './recipe-removal-target'
import { isUnattachedProvision } from './unattached-provisions'

const AckArgs = z.object({ ack: z.string() })
const ClaimArgs = z.object({
  ack: z.string(),
  hostId: z.string().min(1),
  workspaceId: z.string().min(1)
})
const ReleaseArgs = ClaimArgs.omit({ ack: true })
const RollbackArgs = z.object({ runtimeId: z.string().min(1) })

/** Holds the workspace's environment for the removal that is about to delete its checkout. */
export async function claimRecipeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  value: unknown
): Promise<RecipeRemovalClaimResult> {
  const args = ClaimArgs.parse(value)
  if (store.getSettings().experimentalEphemeralVms !== true) {
    return { ok: true, required: false }
  }
  const owner = await currentRecipeOwner(userDataPath, args.hostId, args.workspaceId)
  if (owner === 'ambiguous') {
    return { ok: false, reason: 'replaced' }
  }
  if (!owner) {
    return { ok: true, required: false }
  }
  const claim = claimRecipeRemovalAck(args.ack, {
    hostId: args.hostId,
    workspaceId: owner.workspaceId ?? '',
    runtimeId: owner.id,
    runtimeCreatedAt: owner.createdAt
  })
  return claim.ok ? { ok: true, required: true } : claim
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
    'ephemeralVm:releaseRemoval',
    'ephemeralVm:rollbackRemovalAck'
  ]) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('ephemeralVm:confirmRemoval', (_event, args: unknown) =>
    confirmRecipeRemovalAck(AckArgs.parse(args).ack)
  )
  ipcMain.handle('ephemeralVm:revokeRemoval', (_event, args: unknown) => {
    revokeRecipeRemovalAck(AckArgs.parse(args).ack)
  })
  ipcMain.handle('ephemeralVm:claimRemoval', (_event, args: unknown) =>
    claimRecipeRemoval(store, app.getPath('userData'), args)
  )
  ipcMain.handle('ephemeralVm:releaseRemoval', (_event, args: unknown) => {
    const { hostId, workspaceId } = ReleaseArgs.parse(args)
    releaseRecipeRemovalClaim(hostId, workspaceId)
  })
  ipcMain.handle('ephemeralVm:rollbackRemovalAck', (_event, args: unknown) =>
    rollbackRecipeRemovalAck(app.getPath('userData'), args)
  )
}
