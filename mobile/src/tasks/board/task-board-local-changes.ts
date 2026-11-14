import type { QueryClient } from '@tanstack/react-query'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import { taskBoardCardsKey } from './task-board-query-storage'

// What a write already changed on the host, shown on the board before its next list.

function changeCard(
  queryClient: QueryClient,
  hostId: string,
  refKey: string,
  change: (card: TaskBoardWireCard) => TaskBoardWireCard
): void {
  queryClient.setQueryData<TaskBoardListResult>(taskBoardCardsKey(hostId), (board) =>
    board
      ? {
          ...board,
          cards: board.cards.map((card) => (card.refKey === refKey ? change(card) : card))
        }
      : board
  )
}

/** `moved` null: the host applied the move but could not read the card back. */
export function applyTaskBoardMove(
  queryClient: QueryClient,
  hostId: string,
  refKey: string,
  targetColumnId: string,
  moved: TaskBoardWireCard | null
): void {
  changeCard(queryClient, hostId, refKey, (previous) =>
    moved
      ? {
          ...moved,
          // The move reply is not enriched; the earlier card's enrichment stands until the next list.
          enrichment: previous.enrichment,
          progress: previous.progress,
          latestComment: previous.latestComment,
          unreadComments: previous.unreadComments
        }
      : { ...previous, columnId: targetColumnId }
  )
}

export function clearTaskBoardUnread(
  queryClient: QueryClient,
  hostId: string,
  refKey: string
): void {
  changeCard(queryClient, hostId, refKey, (card) => ({ ...card, unreadComments: 0 }))
}
