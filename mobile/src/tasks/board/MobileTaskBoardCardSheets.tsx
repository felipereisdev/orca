import { useQueryClient } from '@tanstack/react-query'
import type {
  TaskBoardListResult,
  TaskBoardWireCard,
  TaskStartPrimaryReason
} from '../../../../src/shared/task-board/task-board-wire-types'
import { KeyedBottomDrawer } from '../../components/bottom-drawer/keyed-bottom-drawer'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { MobileTaskBoardDetailDrawer } from './MobileTaskBoardDetailDrawer'
import { MobileTaskBoardMoveSheet } from './MobileTaskBoardMoveSheet'
import { MobileTaskStartConfirmSheet } from './MobileTaskStartConfirmSheet'
import { MobileTaskStartSheet } from './MobileTaskStartSheet'
import { taskStartPrimaryReason, taskStopTitle } from './task-board-run-labels'
import { clearTaskBoardUnread, movedTaskBoardCard } from './task-board-local-changes'
import { holdTaskBoardMove, releaseTaskBoardMove } from './task-board-move-holds'
import type { TaskBoardStage } from './task-board-stages'
import type { TaskBoardView } from './use-task-board'
import type { TaskBoardStart, TaskStartChoices } from './use-task-board-start'

export type TaskBoardSheet =
  | { kind: 'detail' | 'move'; card: TaskBoardWireCard }
  /** `repoRequired`: the host could not resolve the card's repository. */
  | { kind: 'start-as'; card: TaskBoardWireCard; repoRequired: boolean }
  | {
      kind: 'confirm-primary'
      card: TaskBoardWireCard
      choices: TaskStartChoices
      reasons: TaskStartPrimaryReason[]
    }
  /** `workers` is null when the preview could not count them. */
  | { kind: 'confirm-stop'; card: TaskBoardWireCard; workers: number | null }

const sheetKey = (sheet: TaskBoardSheet) => `${sheet.kind}:${sheet.card.refKey}`

type Props = {
  hostId: string
  client: RpcClient | null
  view: TaskBoardView
  board: TaskBoardListResult
  stages: readonly TaskBoardStage[]
  sheet: TaskBoardSheet | null
  onSheet: (sheet: TaskBoardSheet | null) => void
  start: TaskBoardStart
}

/** The card's sheets, one at a time: each opens once the one before it is gone. */
export function MobileTaskBoardCardSheets({
  hostId,
  client,
  view,
  board,
  stages,
  sheet,
  onSheet,
  start
}: Props) {
  const t = useMobileTranslation()
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
              onStartAs={start.actions ? () => start.openStartAs(card) : null}
              onClose={() => onSheet(null)}
            />
          )
        }
        if (presented.kind === 'start-as') {
          return (
            <MobileTaskStartSheet
              card={card}
              client={client}
              connected={!view.isOffline}
              repoRequired={presented.repoRequired}
              status={start.startAs}
              onSubmit={(choices) => start.submitStartAs(card, choices)}
              onClose={() => onSheet(null)}
            />
          )
        }
        if (presented.kind === 'confirm-primary') {
          return (
            <MobileTaskStartConfirmSheet
              title={t(
                'tasks.board.start.primaryConfirm.title',
                'Start {{id}} in the primary checkout?',
                { id: card.displayId }
              )}
              description={t(
                'tasks.board.start.primaryConfirm.description',
                'The agents will work directly in the primary checkout.'
              )}
              details={presented.reasons.map((reason) => taskStartPrimaryReason(reason, t))}
              confirmLabel={t('tasks.board.start.primaryConfirm.action', 'Start anyway')}
              onConfirm={() => start.confirmPrimary(card, presented.choices)}
              onClose={() => onSheet(null)}
            />
          )
        }
        if (presented.kind === 'confirm-stop') {
          return (
            <MobileTaskStartConfirmSheet
              title={taskStopTitle(presented.workers, t)}
              description={t(
                'tasks.board.start.stopConfirm.description',
                'The worktree, its branch and commits stay as they are.'
              )}
              confirmLabel={t('tasks.board.start.stopAction', 'Stop')}
              onConfirm={() => start.confirmStop(card)}
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
