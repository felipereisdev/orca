import { app, ipcMain } from 'electron'
import { z } from 'zod'
import type {
  RecipeRemovalCheckResult,
  RecipeRemovalCopyResult,
  RecipeRemovalPreflight,
  RecipeRemovalPreflightReason
} from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import type { DesktopSettingsSource } from './desktop-configure'
import { issueRecipeRemovalAck, type RecipeRemovalAckBinding } from './recipe-removal-acks'
import { registerRecipeRemovalAckHandlers } from './recipe-removal-ack-handlers'
import { resolveRecipeRemoval } from './recipe-removal-target'
import {
  copyRecordingsBeforeRemoval,
  preflightRecipeWorkspaceRemoval
} from './workspace-removal-preflight'
import { removalPreflightPorts as ports } from './workspace-removal-preflight-ports'
import { acceptedRecordings } from './recipe-removal-recording-guard'

/**
 * Every answer carries an ack bound to the owner. Only a clean one may be spent at once; an unsafe
 * or unchecked one waits for the user's explicit confirm. No single owner means no usable ack.
 */
function withAck(
  preflight: RecipeRemovalPreflight,
  binding: RecipeRemovalAckBinding | undefined,
  sessionId: string | undefined
): RecipeRemovalCheckResult {
  return {
    ...preflight,
    ack: binding
      ? issueRecipeRemovalAck(
          binding,
          preflight.status === 'clean',
          sessionId,
          acceptedRecordings(preflight)
        )
      : ''
  }
}

/** The dialog session a request belongs to; its acks are revoked together when it closes. */
const RequestSession = z.object({ sessionId: z.string().min(1).optional() })

function sessionOf(request: unknown): string | undefined {
  return RequestSession.safeParse(request).data?.sessionId
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
  const sessionId = sessionOf(request)
  if (resolved.kind === 'unchecked') {
    return withAck(unchecked(resolved.reason), resolved.binding, sessionId)
  }
  const preflight = await preflightRecipeWorkspaceRemoval(resolved.target, ports(resolved.target))
  return withAck(preflight, resolved.binding, sessionId)
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
    const ack = issueRecipeRemovalAck(resolved.binding, true, sessionOf(request), {
      recordingIds: [],
      inProgress: false
    })
    return { ...outcome, ack }
  }
  return outcome.reason === 'still_pending'
    ? { ...outcome, preflight: withAck(outcome.preflight, resolved.binding, sessionOf(request)) }
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
