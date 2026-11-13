import type { TaskBoardSettings } from '../../../../../shared/task-board/task-board-settings'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import type { TaskBoardCard } from './task-board-card'
import { resolveTaskBoardColumnId } from './task-board-columns'
import { taskBoardCardUpdatedAtMs } from './task-board-provider-results'

/** How long a confirmed move outlives provider reads that still show the old status. */
export const TASK_BOARD_MOVE_OVERRIDE_TTL_MS = 2 * 60 * 1000

/** A dropped card held in its target column: in flight while `expiresAt` is unset, then the confirmed card. */
export type TaskBoardMoveOverride = {
  card: TaskBoardCard
  columnId: string
  expiresAt?: number
}

export type PlacedTaskBoardCard = { card: TaskBoardCard; columnId: string }

/** A read replaces a confirmed move once it agrees with it or carries a later change. */
function readSupersedes(
  read: TaskBoardCard,
  readColumnId: string | null,
  override: TaskBoardMoveOverride
): boolean {
  if (override.expiresAt === undefined) {
    return false
  }
  return (
    readColumnId === override.columnId ||
    taskBoardCardUpdatedAtMs(read) > taskBoardCardUpdatedAtMs(override.card)
  )
}

/** Places read cards in columns, newest first; a move override wins over a read it is newer than. */
export function placeTaskBoardCards(
  cards: readonly TaskBoardCard[],
  overrides: ReadonlyMap<string, TaskBoardMoveOverride>,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): PlacedTaskBoardCard[] {
  const placed: PlacedTaskBoardCard[] = []
  const read = new Set<string>()
  for (const card of cards) {
    read.add(card.refKey)
    const columnId = resolveTaskBoardColumnId(card, columns, settings)
    const override = overrides.get(card.refKey)
    if (override && !readSupersedes(card, columnId, override)) {
      placed.push({ card: override.card, columnId: override.columnId })
    } else if (columnId !== null) {
      placed.push({ card, columnId })
    }
  }
  // A lagging search can drop a moved card altogether (e.g. a reopened issue not yet indexed as open).
  for (const [refKey, override] of overrides) {
    if (!read.has(refKey)) {
      placed.push({ card: override.card, columnId: override.columnId })
    }
  }
  return placed.sort((a, b) => taskBoardCardUpdatedAtMs(b.card) - taskBoardCardUpdatedAtMs(a.card))
}
