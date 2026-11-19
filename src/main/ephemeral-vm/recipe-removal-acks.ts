import { randomBytes } from 'node:crypto'
import { RecipeWorkspaceRemovalError } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-host-removal'

/** How long a check's answer stays usable while the user reads it. */
export const RECIPE_REMOVAL_ACK_TTL_MS = 2 * 60_000
/** A claimed removal must still destroy after deleting the checkout and polling its removal. */
export const RECIPE_REMOVAL_CLAIM_TTL_MS = 10 * 60_000

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

const acks = new Map<string, RecipeRemovalAckBinding & { state: AckState; expiresAt: number }>()
/** Removals that began their irreversible steps, keyed by the runtime record they will destroy. */
const claims = new Map<string, RecipeRemovalAckBinding & { expiresAt: number }>()

function recordKey(runtimeId: string, createdAt: number): string {
  return `${runtimeId}\0${createdAt}`
}

function live(ack: string) {
  const now = Date.now()
  for (const store of [acks, claims]) {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key)
      }
    }
  }
  return acks.get(ack)
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
  confirmed: boolean
): string {
  live('')
  const ack = randomBytes(16).toString('hex')
  acks.set(ack, {
    ...binding,
    state: confirmed ? 'confirmed' : 'pending',
    expiresAt: Date.now() + RECIPE_REMOVAL_ACK_TTL_MS
  })
  return ack
}

/** The user chose to remove after seeing the answer. False when the ack is gone. */
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

/** Cancel or close: the answer authorizes nothing afterwards. */
export function revokeRecipeRemovalAck(ack: string): void {
  acks.delete(ack)
}

export type RecipeRemovalClaim = { ok: true } | { ok: false; reason: 'unconfirmed' | 'replaced' }

/**
 * Before a removal's first irreversible step: turns a confirmed ack into an authorization held for
 * the record that owns the workspace now, long enough for the whole removal. With no ack, an
 * authorization an earlier claim left for that same record still counts.
 */
export function claimRecipeRemovalAck(
  ack: string,
  current: RecipeRemovalAckBinding
): RecipeRemovalClaim {
  const entry = live(ack)
  const key = recordKey(current.runtimeId, current.runtimeCreatedAt)
  if (!ack) {
    const held = claims.get(key)
    return held && held.hostId === current.hostId && held.workspaceId === current.workspaceId
      ? { ok: true }
      : { ok: false, reason: 'unconfirmed' }
  }
  if (!entry || entry.state === 'pending') {
    return { ok: false, reason: 'unconfirmed' }
  }
  if (
    entry.hostId !== current.hostId ||
    entry.workspaceId !== current.workspaceId ||
    entry.runtimeId !== current.runtimeId ||
    entry.runtimeCreatedAt !== current.runtimeCreatedAt
  ) {
    return { ok: false, reason: 'replaced' }
  }
  acks.delete(ack)
  claims.set(key, { ...current, expiresAt: Date.now() + RECIPE_REMOVAL_CLAIM_TTL_MS })
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
  const key = recordKey(runtime.id, runtime.createdAt)
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
  // A removal that claimed this record already deleted its checkout; its destroy goes on.
  const held = claims.get(key)
  if (held && held.workspaceId === workspaceId && runtime.hostIds.includes(held.hostId)) {
    claims.delete(key)
    return
  }
  throw refused()
}
