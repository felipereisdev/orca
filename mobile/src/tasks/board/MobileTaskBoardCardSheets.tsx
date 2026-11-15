import { useQueryClient } from '@tanstack/react-query'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import { KeyedBottomDrawer } from '../../components/bottom-drawer/keyed-bottom-drawer'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { MobileTaskBoardDetailDrawer } from './MobileTaskBoardDetailDrawer'
import { MobileTaskBoardMoveSheet } from './MobileTaskBoardMoveSheet'
import { clearTaskBoardUnread, movedTaskBoardCard } from './task-board-local-changes'
import { holdTaskBoardMove, releaseTaskBoardMove } from './task-board-move-holds'
import type { TaskBoardStage } from './task-board-stages'
import type { TaskBoardView } from './use-task-board'

export type TaskBoardSheet = { kind: 'detail' | 'move'; card: TaskBoardWireCard }

const sheetKey = (sheet: TaskBoardSheet) => `${sheet.kind}:${sheet.card.refKey}`

type Props = {
  hostId: string
  client: RpcClient | null
  view: TaskBoardView
  board: TaskBoardListResult
  stages: readonly TaskBoardStage[]
  sheet: TaskBoardSheet | null
  onSheet: (sheet: TaskBoardSheet | null) => void
}

/** The card drawer and the move sheet, one at a time: the move sheet opens once the drawer is gone. */
export function MobileTaskBoardCardSheets({
  hostId,
  client,
  view,
  board,
  stages,
  sheet,
  onSheet
}: Props) {
  const queryClient = useQueryClient()
  const { refresh, relist } = view
  const openRefKey = sheet?.kind === 'detail' ? sheet.card.refKey : null

  return (
    <KeyedBottomDrawer sheet={sheet} sheetKey={sheetKey} onClose={() => onSheet(null)}>
      {(presented) => {
        // The board's latest copy of the card, or the one opened if a list has since dropped it.
        const card =
          board.cards.find((candidate) => candidate.refKey === presented.card.refKey) ??
          presented.card
        if (presented.kind === 'detail') {
          return (
            <MobileTaskBoardDetailDrawer
              card={card}
              started={stages.find((stage) => stage.id === card.columnId)?.started ?? false}
              client={client}
              connected={!view.isOffline}
              open={openRefKey === card.refKey}
              onSeen={() => clearTaskBoardUnread(queryClient, hostId, card.refKey)}
              onMove={() => onSheet({ kind: 'move', card })}
              onClose={() => onSheet(null)}
            />
          )
        }
        return (
          <MobileTaskBoardMoveSheet
            card={card}
            columns={board.columns}
            client={client}
            offline={view.isOffline}
            onMoved={(targetColumnId, moved) => {
              const placed = movedTaskBoardCard(card, moved, targetColumnId)
              holdTaskBoardMove(hostId, placed, placed.columnId)
              onSheet(null)
              relist()
            }}
            onUnconfirmed={() => void refresh()}
            onAlreadyThere={() => {
              // No hold may keep the card where the phone last put it; a fresh list places it.
              releaseTaskBoardMove(hostId, card.refKey)
              onSheet(null)
              void refresh()
            }}
            onClose={() => onSheet(null)}
          />
        )
      }}
    </KeyedBottomDrawer>
  )
}
