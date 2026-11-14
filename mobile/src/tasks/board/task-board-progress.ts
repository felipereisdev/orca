import type {
  TaskBoardProgress,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import type { Translate } from '../../i18n/mobile-i18n'

export type TaskBoardStepState = 'done' | 'failed' | 'pending'

/** Workspace → commits → review → checks, as far as the card's work has got. */
export function taskBoardProgressSteps(
  progress: TaskBoardProgress | null | undefined
): TaskBoardStepState[] {
  if (!progress) {
    return ['pending', 'pending', 'pending', 'pending']
  }
  return [
    'done',
    (progress.commitsAhead ?? 0) > 0 ? 'done' : 'pending',
    progress.review ? 'done' : 'pending',
    progress.checks === 'success' ? 'done' : progress.checks === 'failure' ? 'failed' : 'pending'
  ]
}

// Jira and Linear work can land on either forge, so the review's own URL decides PR or MR.
export function taskBoardReviewLabel(
  provider: TaskBoardWireCard['provider'],
  progress: TaskBoardProgress | null | undefined,
  t: Translate
): string {
  const url = progress?.review?.url
  const pullRequest = url ? url.includes('/pull/') : provider === 'github'
  return pullRequest ? t('tasks.board.card.stepPr', 'PR') : t('tasks.board.card.stepMr', 'MR')
}

export function taskBoardChecksLabel(
  checks: TaskBoardProgress['checks'],
  t: Translate
): string | null {
  switch (checks) {
    case 'success':
      return t('tasks.board.card.checksPassed', 'Checks passed')
    case 'failure':
      return t('tasks.board.card.checksFailed', 'Checks failed')
    case 'pending':
      return t('tasks.board.card.checksRunning', 'Checks running')
    case 'none':
      return null
  }
}

export function taskBoardUnreadLabel(count: number, t: Translate): string {
  return count === 1
    ? t('tasks.board.card.unread_one', '{{count}} new', { count })
    : t('tasks.board.card.unread_other', '{{count}} new', { count })
}
