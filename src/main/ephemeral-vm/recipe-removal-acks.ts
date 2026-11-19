import { randomBytes } from 'node:crypto'
import { RecipeWorkspaceRemovalError } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-host-removal'

/** An acknowledgement outlives the dialog's read time, never a stale check. */
export const RECIPE_REMOVAL_ACK_TTL_MS = 2 * 60_000

/** What an acknowledgement vouches for: one workspace on one host, owned by one runtime record. */
export type RecipeRemovalAckBinding = {
  hostId: string
  workspaceId: string
  runtimeId: string
  /** Tells a replacement record under the same id apart from the one that was checked. */
  runtimeCreatedAt: number
}

const acks = new Map<string, RecipeRemovalAckBinding & { expiresAt: number }>()

function prune(now: number): void {
  for (const [ack, entry] of acks) {
    if (entry.expiresAt <= now) {
      acks.delete(ack)
    }
  }
}

/** Issued with every removal check, whatever it found: the user saw that answer. */
export function issueRecipeRemovalAck(binding: RecipeRemovalAckBinding): string {
  const now = Date.now()
  prune(now)
  const ack = randomBytes(16).toString('hex')
  acks.set(ack, { ...binding, expiresAt: now + RECIPE_REMOVAL_ACK_TTL_MS })
  return ack
}

/**
 * Spends an acknowledgement for this exact runtime record. Missing, expired, used or issued for
 * another host, workspace or record refuses the destroy.
 */
export function consumeRecipeRemovalAck(
  ack: string,
  runtime: { id: string; createdAt: number; hostIds: readonly string[]; workspaceId?: string }
): void {
  const now = Date.now()
  prune(now)
  const entry = acks.get(ack)
  if (
    !entry ||
    entry.runtimeId !== runtime.id ||
    entry.runtimeCreatedAt !== runtime.createdAt ||
    !runtime.hostIds.includes(entry.hostId) ||
    (runtime.workspaceId !== undefined && entry.workspaceId !== runtime.workspaceId)
  ) {
    throw new RecipeWorkspaceRemovalError(
      'recipe_removal_unconfirmed',
      'This recipe workspace removal was not confirmed. Check the workspace again before removing it.'
    )
  }
  acks.delete(ack)
}
