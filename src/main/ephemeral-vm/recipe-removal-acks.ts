import { randomBytes } from 'node:crypto'
import { RecipeWorkspaceRemovalError } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-host-removal'

/** How long a check's answer stays usable while the user reads it. */
export const RECIPE_REMOVAL_ACK_TTL_MS = 2 * 60_000
/** A safety net only: a claim ends when its destroy spends it or its failed removal releases it. */
export const RECIPE_REMOVAL_CLAIM_TTL_MS = 60 * 60_000

/** What an acknowledgement vouches for: one workspace on one host, owned by one runtime record. */
export type RecipeRemovalAckBinding = {
  hostId: string
  workspaceId: string
  runtimeId: string
  /** Tells a replacement record under the same id apart from the one that was checked. */
  runtimeCreatedAt: number
}

/**
 * `pending`: the user has not decided yet (an unsafe or unchecked answer). `confirmed`: clean, or
 * the user chose to remove. A claim moves it out of here into a held authorization.
 */
type AckState = 'pending' | 'confirmed'

/** `sessionId`: the dialog that showed the answer; closing it revokes the whole session. */
type Session = { sessionId?: string; fence?: RemovalRecordingFence }
export type RemovalRecordingFence = {
  hold: () => Promise<boolean>
  release: () => Promise<void>
  mayBeHeld: () => boolean
}

/**
 * The recordings the answer showed as lost, which a claim's final list may still find. `unknown`:
 * the answer was unchecked, so the user accepted not knowing.
 */
export type RecipeRemovalAcceptedRecordings =
  | { recordingIds: readonly string[]; inProgress: boolean }
  | 'unknown'

const acks = new Map<
  string,
  RecipeRemovalAckBinding &
    Session & { state: AckState; accepted: RecipeRemovalAcceptedRecordings; expiresAt: number }
>()
/**
 * Removals that began their irreversible steps, keyed by the ack each claim came from.
 * `adopted`: the store removal took it over, so closing its dialog no longer revokes it.
 */
const claims = new Map<
  string,
  RecipeRemovalAckBinding & Session & { adopted: boolean; expiresAt: number }
>()

// A closed session must not mint another ack from work still in flight.
const revokedSessions = new Map<string, number>()
const pendingFences = new Map<RemovalRecordingFence, string>()

export async function trackRecipeRemovalFence<T>(
  sessionId: string | undefined,
  fence: RemovalRecordingFence,
  run: () => Promise<T>
): Promise<T> {
  if (!sessionId) {
    return run()
  }
  if ((revokedSessions.get(sessionId) ?? 0) > Date.now()) {
    void fence.release()
  }
  pendingFences.set(fence, sessionId)
  try {
    return await run()
  } finally {
    pendingFences.delete(fence)
  }
}

function live(ack: string) {
  const now = Date.now()
  for (const store of [acks, claims]) {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now && !entry.fence?.mayBeHeld()) {
        store.delete(key)
      }
    }
  }
  for (const [sessionId, expiresAt] of revokedSessions) {
    if (expiresAt <= now) {
      revokedSessions.delete(sessionId)
    }
  }
  const entry = acks.get(ack)
  return entry && entry.expiresAt > now ? entry : undefined
}

function refused(): RecipeWorkspaceRemovalError {
  return new RecipeWorkspaceRemovalError(
    'recipe_removal_unconfirmed',
    'This recipe workspace removal was not confirmed. Check the workspace again before removing it.'
  )
}

/** Issued with every removal check; only a clean answer can be used before the user decides. */
export function issueRecipeRemovalAck(
  binding: RecipeRemovalAckBinding,
  confirmed: boolean,
  sessionId?: string,
  accepted: RecipeRemovalAcceptedRecordings = 'unknown',
  fence?: RemovalRecordingFence
): string {
  live('')
  const ack = randomBytes(16).toString('hex')
  if (sessionId && revokedSessions.has(sessionId)) {
    return ack
  }
  acks.set(ack, {
    ...binding,
    sessionId,
    fence,
    state: confirmed ? 'confirmed' : 'pending',
    accepted,
    expiresAt: Date.now() + RECIPE_REMOVAL_ACK_TTL_MS
  })
  return ack
}

export function confirmRecipeRemovalAck(ack: string): boolean {
  const entry = live(ack)
  if (!entry) {
    return false
  }
  if (entry.state === 'pending') {
    entry.state = 'confirmed'
    entry.expiresAt = Date.now() + RECIPE_REMOVAL_ACK_TTL_MS
  }
  return true
}

/** Cancel or close: the answer, and any claim already made from it, authorize nothing afterwards. */
export async function revokeRecipeRemovalAck(ack: string): Promise<void> {
  const fence = (acks.get(ack) ?? claims.get(ack))?.fence
  acks.delete(ack)
  claims.delete(ack)
  if (fence) {
    await fence.release()
  }
}

/** The dialog closed or retargeted: its answers and every claim the store didn't adopt end. */
export async function revokeRecipeRemovalSession(sessionId: string): Promise<void> {
  revokedSessions.set(sessionId, Date.now() + RECIPE_REMOVAL_CLAIM_TTL_MS)
  const releases: Promise<void>[] = []
  for (const [fence, owner] of pendingFences) {
    if (owner === sessionId) {
      releases.push(fence.release())
    }
  }
  for (const [ack, entry] of acks) {
    if (entry.sessionId === sessionId) {
      acks.delete(ack)
      if (entry.fence) {
        releases.push(entry.fence.release())
      }
    }
  }
  for (const [ack, claim] of claims) {
    if (claim.sessionId === sessionId && !claim.adopted) {
      claims.delete(ack)
      if (claim.fence) {
        releases.push(claim.fence.release())
      }
    }
  }
  await Promise.all(releases)
}

/** A removal that failed after claiming: its environment is no longer held for a destroy. */
export function releaseRecipeRemovalClaim(hostId: string, workspaceId: string): void {
  for (const [ack, claim] of claims) {
    if (claim.hostId === hostId && claim.workspaceId === workspaceId) {
      claims.delete(ack)
      void claim.fence?.release()
    }
  }
}

export type RecipeRemovalClaim = { ok: true } | { ok: false; reason: 'unconfirmed' | 'replaced' }

function claimableAck(ack: string, current: RecipeRemovalAckBinding) {
  const entry = live(ack)
  if (!entry || entry.state === 'pending') {
    return { ok: false as const, reason: 'unconfirmed' as const }
  }
  if (
    entry.hostId !== current.hostId ||
    entry.workspaceId !== current.workspaceId ||
    entry.runtimeId !== current.runtimeId ||
    entry.runtimeCreatedAt !== current.runtimeCreatedAt
  ) {
    return { ok: false as const, reason: 'replaced' as const }
  }
  return { ok: true as const, entry }
}

export function peekRecipeRemovalAck(
  ack: string,
  current: RecipeRemovalAckBinding,
  fallbackFence?: RemovalRecordingFence
):
  | { ok: true; accepted: RecipeRemovalAcceptedRecordings; fence?: RemovalRecordingFence }
  | { ok: false; reason: 'unconfirmed' | 'replaced' } {
  const checked = claimableAck(ack, current)
  if (!checked.ok) {
    return checked
  }
  checked.entry.fence ??= fallbackFence
  return { ok: true, accepted: checked.entry.accepted, fence: checked.entry.fence }
}

/**
 * Before a removal's first irreversible step: turns a confirmed ack into an authorization held for
 * the record that owns the workspace now, long enough for the whole removal.
 */
export function claimRecipeRemovalAck(
  ack: string,
  current: RecipeRemovalAckBinding
): RecipeRemovalClaim {
  const checked = claimableAck(ack, current)
  if (!checked.ok) {
    return checked
  }
  acks.delete(ack)
  claims.set(ack, {
    ...current,
    sessionId: checked.entry.sessionId,
    fence: checked.entry.fence,
    adopted: false,
    expiresAt: Date.now() + RECIPE_REMOVAL_CLAIM_TTL_MS
  })
  return { ok: true }
}

/**
 * The store removal takes over the claim its decision made, in the same dialog session (none for
 * removals that claim on their own). From here only its destroy or its release ends it.
 */
export function adoptRecipeRemovalClaim(
  current: RecipeRemovalAckBinding,
  sessionId: string | undefined
): RecipeRemovalClaim {
  live('')
  const held = [...claims.values()].findLast(
    (claim) =>
      claim.runtimeId === current.runtimeId &&
      claim.runtimeCreatedAt === current.runtimeCreatedAt &&
      claim.hostId === current.hostId &&
      claim.workspaceId === current.workspaceId &&
      claim.sessionId === sessionId
  )
  if (!held) {
    return { ok: false, reason: 'unconfirmed' }
  }
  held.adopted = true
  return { ok: true }
}

/**
 * Spends an acknowledgement for this exact runtime record. Missing, expired, used, undecided or
 * issued for another host, workspace or record refuses the destroy.
 */
export function consumeRecipeRemovalAck(
  ack: string,
  runtime: { id: string; createdAt: number; hostIds: readonly string[]; workspaceId?: string }
): void {
  const entry = live(ack)
  const workspaceId = runtime.workspaceId ?? ''
  if (
    entry &&
    entry.state !== 'pending' &&
    entry.runtimeId === runtime.id &&
    entry.runtimeCreatedAt === runtime.createdAt &&
    runtime.hostIds.includes(entry.hostId) &&
    entry.workspaceId === workspaceId
  ) {
    acks.delete(ack)
    return
  }
  // A destroy spends the held authorization for this checkout once, even if multiple claims hold it.
  let consumed = false
  for (const [claimedAck, claim] of claims) {
    if (
      claim.runtimeId === runtime.id &&
      claim.runtimeCreatedAt === runtime.createdAt &&
      claim.workspaceId === workspaceId &&
      runtime.hostIds.includes(claim.hostId)
    ) {
      claims.delete(claimedAck)
      consumed = true
    }
  }
  if (!consumed) {
    throw refused()
  }
}
