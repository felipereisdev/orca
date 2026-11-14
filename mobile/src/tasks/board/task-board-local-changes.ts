import type { QueryClient } from '@tanstack/react-query'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import { changeHeldTaskBoardCard } from './task-board-move-holds'
import { taskBoardCardsKey } from './task-board-query-storage'

// What a write already changed on the host, shown on the board before its next list.

/** The card a move left; `moved` null: the host applied it but could not read the card back. */
export function movedTaskBoardCard(
  previous: TaskBoardWireCard,
  moved: TaskBoardWireCard | null,
  targetColumnId: string
): TaskBoardWireCard {
  if (!moved) {
    return { ...previous, columnId: targetColumnId }
  }
  return {
    ...moved,
    // The move reply is not enriched; the earlier card's enrichment stands until the next list.
    enrichment: previous.enrichment,
    progress: previous.progress,
    latestComment: previous.latestComment,
    unreadComments: previous.unreadComments
  }
}

export function clearTaskBoardUnread(
  queryClient: QueryClient,
  hostId: string,
  refKey: string
): void {
  const clear = (card: TaskBoardWireCard): TaskBoardWireCard => ({ ...card, unreadComments: 0 })
  queryClient.setQueryData<TaskBoardListResult>(taskBoardCardsKey(hostId), (board) =>
    board
      ? {
          ...board,
          cards: board.cards.map((card) => (card.refKey === refKey ? clear(card) : card))
        }
      : board
  )
  changeHeldTaskBoardCard(hostId, refKey, clear)
}
