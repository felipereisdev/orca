import { resolveTaskBoardColumnId } from '../../shared/task-board/task-board-columns'
import type { TaskBoardCardRef } from '../../shared/task-board/task-board-wire-types'
import { readTaskBoardCard } from './task-board-host-card'
import { moveTaskBoardCard, type TaskBoardMoveDeps } from './task-board-host-move'

/** `kept`: already there or past it, no such column, or the run ended; `skipped`: the move needs the user. */
export type TaskStartCardMove = 'moved' | 'kept' | 'skipped'

/** Moves a started card forward to `columnId` the way a drag does; never backwards, never for an ended run. */
export async function moveStartedTaskBoardCard(
  ref: TaskBoardCardRef,
  columnId: string,
  runAlive: () => boolean,
  deps: TaskBoardMoveDeps
): Promise<TaskStartCardMove> {
  const columns = deps.host.statuses()
  const target = columns.findIndex((column) => column.id === columnId)
  if (target === -1) {
    return 'kept'
  }
  const card = await readTaskBoardCard(ref, deps)
  const current = resolveTaskBoardColumnId(card, columns, deps.host.settings().taskBoard)
  const index = columns.findIndex((column) => column.id === current)
  // A stop during the read leaves the card where it was.
  if (index === -1 || index >= target || !runAlive()) {
    return 'kept'
  }
  const result = await moveTaskBoardCard({ ref, targetColumnId: columnId }, deps)
  if (result.status === 'moved') {
    return 'moved'
  }
  if (result.status === 'blocked' && result.reason === 'same-column') {
    return 'kept'
  }
  console.warn('[task-start] the started card was not moved', result)
  return 'skipped'
}
