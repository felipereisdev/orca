import { View } from 'react-native'
import type {
  TaskBoardEnrichment,
  TaskBoardProgress,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import { ListGroup, ListRow, SectionHeader } from '../../components/list/ListGroup'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import {
  taskBoardChecksLabel,
  taskBoardProgressSteps,
  taskBoardReviewLabel,
  type TaskBoardStepState
} from './task-board-progress'

function StepDot({ state }: { state: TaskBoardStepState }) {
  return (
    <View
      style={[
        styles.dot,
        state === 'done' && styles.done,
        state === 'failed' && styles.failed,
        state === 'pending' && styles.pending
      ]}
    />
  )
}

type Props = {
  provider: TaskBoardWireCard['provider']
  progress: TaskBoardProgress | null | undefined
  enrichment: TaskBoardEnrichment | undefined
}

/** The card's work, one row per step: workspace, commits, review, checks. */
export function MobileTaskBoardProgressTimeline({ provider, progress, enrichment }: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const header = <SectionHeader title={t('tasks.board.detail.progress', 'Progress')} first />
  if (!progress && enrichment === 'unavailable') {
    return (
      <>
        {header}
        <ListGroup>
          <ListRow title={t('tasks.board.card.progressUnavailable', 'Progress unavailable')} />
        </ListGroup>
      </>
    )
  }
  const steps = taskBoardProgressSteps(progress)
  const none = t('tasks.board.detail.none', 'None yet')
  const commits = progress?.commitsAhead ?? 0
  const review = progress?.review
  return (
    <>
      {header}
      <ListGroup>
        <ListRow
          title={t('tasks.board.card.stepWorkspace', 'Workspace')}
          leading={<StepDot state={steps[0]} />}
          value={
            progress
              ? (progress.branch ?? t('tasks.board.card.noBranch', 'No branch'))
              : t('tasks.board.card.noWorkspace', 'No workspace yet')
          }
        />
        <ListRow
          title={t('tasks.board.card.stepCommits', 'Commits')}
          leading={<StepDot state={steps[1]} />}
          value={
            commits > 0
              ? t('tasks.board.detail.commitsAhead', '{{count}} ahead', { count: commits })
              : none
          }
        />
        <ListRow
          title={taskBoardReviewLabel(provider, progress, t)}
          leading={<StepDot state={steps[2]} />}
          value={review ? `#${String(review.number)} · ${review.state}` : none}
        />
        <ListRow
          title={t('tasks.board.card.stepChecks', 'Checks')}
          leading={<StepDot state={steps[3]} />}
          value={(progress && taskBoardChecksLabel(progress.checks, t)) ?? none}
        />
      </ListGroup>
    </>
  )
}

const styles = themedStyleSheet(() => ({
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill
  },
  done: {
    backgroundColor: colors.statusGreen
  },
  failed: {
    backgroundColor: colors.statusRed
  },
  pending: {
    borderWidth: 1.5,
    borderColor: colors.textMuted
  }
}))
