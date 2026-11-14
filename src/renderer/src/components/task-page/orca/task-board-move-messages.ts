import { translate } from '@/i18n/i18n'
import type { TaskBoardMoveResult } from '../../../../../shared/task-board/task-board-wire-types'

type BlockedReason = Extract<TaskBoardMoveResult, { status: 'blocked' }>['reason']

export function taskBoardMoveErrorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : translate('auto.components.taskPageJiraBoard.changeStatusFailed', 'Failed to change status.')
}

/** Why the host refused a move; `same-column` never reaches the user. */
export function taskBoardBlockedMessage(
  reason: Exclude<BlockedReason, 'same-column'>,
  card: { displayId: string },
  columnLabel: string
): string {
  switch (reason) {
    case 'no-mapping':
      return translate(
        'taskBoard.noColumnMapping',
        'Map a status to {{column}} in Settings → Tasks.',
        { column: columnLabel }
      )
    case 'no-transition':
      return translate(
        'jira.board.noTransition',
        'No status change to {{column}} is available for {{key}}.',
        { column: columnLabel, key: card.displayId }
      )
    case 'invalid-choice':
      return translate(
        'taskBoard.choiceExpired',
        'That status change is no longer available. Try the move again.'
      )
  }
}
