import type { TaskBoardWireCard } from './task-board-wire-types'
import { taskBoardCardUpdatedAtMs } from './task-board-provider-results'

/** How long a confirmed move outlives host lists that still show the old status. */
export const TASK_BOARD_MOVE_OVERRIDE_TTL_MS = 2 * 60 * 1000

/** A dropped card held in its target column: in flight while `expiresAt` is unset, then the confirmed card. */
export type TaskBoardMoveOverride = {
  card: TaskBoardWireCard
  columnId: string
  expiresAt?: number
  /** Expired and waiting on a fresh list, whose result then replaces it. */
  rereading?: true
}

export type PlacedTaskBoardCard = { card: TaskBoardWireCard; columnId: string }

/** A listed card replaces a confirmed move once it agrees with it or carries a later change. */
function readSupersedes(read: TaskBoardWireCard, override: TaskBoardMoveOverride): boolean {
  if (override.expiresAt === undefined) {
    return false
  }
  return (
    read.columnId === override.columnId ||
    taskBoardCardUpdatedAtMs(read) > taskBoardCardUpdatedAtMs(override.card)
  )
}

/** Places cards in the host's columns, newest first; a move override wins over a list it is newer than. */
export function placeTaskBoardCards(
  cards: readonly TaskBoardWireCard[],
  overrides: ReadonlyMap<string, TaskBoardMoveOverride>
): PlacedTaskBoardCard[] {
  const placed: PlacedTaskBoardCard[] = []
  const read = new Set<string>()
  for (const card of cards) {
    read.add(card.refKey)
    const override = overrides.get(card.refKey)
    placed.push(
      override && !readSupersedes(card, override)
        ? { card: override.card, columnId: override.columnId }
        : { card, columnId: card.columnId }
    )
  }
  // A lagging search can drop a moved card altogether (e.g. a reopened issue not yet indexed as open).
  for (const [refKey, override] of overrides) {
    if (!read.has(refKey)) {
      placed.push({ card: override.card, columnId: override.columnId })
    }
  }
  return placed.sort((a, b) => taskBoardCardUpdatedAtMs(b.card) - taskBoardCardUpdatedAtMs(a.card))
}

/** Marks expired confirmed holds as re-reading, in place; true when any did expire. */
export function startExpiredTaskBoardMoveRereads(
  overrides: Map<string, TaskBoardMoveOverride>,
  now: number
): boolean {
  let expired = false
  for (const [refKey, override] of overrides) {
    if (override.expiresAt !== undefined && !override.rereading && override.expiresAt <= now) {
      overrides.set(refKey, { ...override, rereading: true })
      expired = true
    }
  }
  return expired
}

/** The fresh list is now authoritative; a hold re-made meanwhile (no `rereading`) stays. */
export function finishTaskBoardMoveRereads(overrides: Map<string, TaskBoardMoveOverride>): void {
  for (const [refKey, override] of overrides) {
    if (override.rereading) {
      overrides.delete(refKey)
    }
  }
}

/** When the next confirmed hold expires; null when none is waiting to. */
export function nextTaskBoardMoveExpiry(
  overrides: ReadonlyMap<string, TaskBoardMoveOverride>
): number | null {
  const expiries = [...overrides.values()].flatMap((override) =>
    override.expiresAt === undefined || override.rereading ? [] : [override.expiresAt]
  )
  return expiries.length > 0 ? Math.min(...expiries) : null
}
