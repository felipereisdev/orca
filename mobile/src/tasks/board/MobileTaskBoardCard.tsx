import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { GitBranch } from 'lucide-react-native'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import { isTaskStartRunExclusive } from '../../../../src/shared/task-board/task-start-run'
import { TaskProviderLogo } from '../../components/TaskProviderLogo'
import type { Translate } from '../../i18n/mobile-i18n'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { getLinearPriorityLabel } from '../hosted-review/mobile-tasks-hosted-review'
import { formatUpdatedAt } from '../item-detail/mobile-tasks-item-mapping'
import { cardStyles as styles } from './mobile-task-board-card-styles'
import { CardRunButton, CardRunProgress, type TaskBoardRunActions } from './MobileTaskBoardCardRun'
import { taskStartStatusText } from './task-board-run-labels'
import {
  taskBoardChecksLabel,
  taskBoardProgressSteps,
  taskBoardReviewLabel,
  taskBoardUnreadLabel
} from './task-board-progress'

// The host labels Linear priority in English; relabel from the number, as the Linear list does.
function cardPriorityLabel(card: TaskBoardWireCard): string | undefined {
  if (card.source.provider !== 'linear') {
    return card.priorityLabel
  }
  const { priority } = card.source.item
  return typeof priority === 'number' && priority > 0 ? getLinearPriorityLabel(priority) : undefined
}

// Read at render: the palette changes with the color scheme.
function checksColor(checks: 'success' | 'failure' | 'pending'): string {
  return checks === 'success'
    ? colors.statusGreen
    : checks === 'failure'
      ? colors.statusRed
      : colors.statusAmber
}

function ChecksText({ card, review }: { card: TaskBoardWireCard; review: string }) {
  const t = useMobileTranslation()
  const progress = card.progress
  if (!progress) {
    return null
  }
  if (progress.checks === 'none') {
    return progress.review ? null : (
      <Text style={[styles.checks, { color: colors.textMuted }]}>
        {t('tasks.board.card.noReview', 'No {{review}} yet', { review })}
      </Text>
    )
  }
  return (
    <Text style={[styles.checks, { color: checksColor(progress.checks) }]}>
      {taskBoardChecksLabel(progress.checks, t)}
    </Text>
  )
}

/** Workspace → commits → review → checks, then the branch and how its checks went. */
function CardProgress({ card }: { card: TaskBoardWireCard }) {
  const t = useMobileTranslation()
  const review = taskBoardReviewLabel(card.provider, card.progress, t)
  const steps = taskBoardProgressSteps(card.progress)
  const labels = [
    t('tasks.board.card.stepWorkspace', 'Workspace'),
    t('tasks.board.card.stepCommits', 'Commits'),
    review,
    t('tasks.board.card.stepChecks', 'Checks')
  ]
  return (
    <>
      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={labels[index]} style={styles.step}>
            <View
              style={[
                styles.stepBar,
                step === 'done' && styles.stepDone,
                step === 'failed' && styles.stepFailed
              ]}
            />
            <Text
              style={[styles.stepLabel, step !== 'pending' && styles.stepLabelDone]}
              numberOfLines={1}
            >
              {labels[index]}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.branchRow}>
        <GitBranch size={13} color={colors.textMuted} />
        <Text style={styles.branch} numberOfLines={1}>
          {card.progress
            ? (card.progress.branch ?? t('tasks.board.card.noBranch', 'No branch'))
            : card.enrichment === 'unavailable'
              ? t('tasks.board.card.progressUnavailable', 'Progress unavailable')
              : t('tasks.board.card.noWorkspace', 'No workspace yet')}
        </Text>
        <ChecksText card={card} review={review} />
      </View>
    </>
  )
}

/** The newest comment, with how many the user has not seen yet. */
function CardComment({ card }: { card: TaskBoardWireCard }) {
  const t = useMobileTranslation()
  const latest = card.latestComment
  const unread = card.unreadComments ?? 0
  if (!latest && unread === 0) {
    return null
  }
  return (
    <View style={styles.comment}>
      {latest ? (
        <>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{latest.author.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.commentBody}>
            <Text style={styles.commentByline} numberOfLines={1}>
              <Text style={styles.commentAuthor}>{latest.author}</Text>
              {` · ${formatUpdatedAt(latest.at)}`}
            </Text>
            <Text style={styles.commentExcerpt} numberOfLines={2}>
              {latest.excerpt}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.commentBody} />
      )}
      {unread > 0 ? <Text style={styles.unread}>{taskBoardUnreadLabel(unread, t)}</Text> : null}
    </View>
  )
}

// The card is one button to a screen reader, so its label carries what the drawn progress shows.
function cardAccessibilityLabel(card: TaskBoardWireCard, started: boolean, t: Translate): string {
  const parts = [card.displayId, card.title]
  if (card.taskStart) {
    parts.push(`${taskStartStatusText(card.taskStart, t)} ${card.taskStart.percent}%`)
  }
  if (started) {
    const steps = taskBoardProgressSteps(card.progress)
    parts.push(
      t('tasks.board.card.stepsDone', '{{done}} of {{total}} steps done', {
        done: steps.filter((step) => step === 'done').length,
        total: steps.length
      })
    )
    const checks = card.progress ? taskBoardChecksLabel(card.progress.checks, t) : null
    if (checks) {
      parts.push(checks)
    }
    if ((card.unreadComments ?? 0) > 0) {
      parts.push(taskBoardUnreadLabel(card.unreadComments ?? 0, t))
    }
  }
  return parts.join(', ')
}

type Props = {
  card: TaskBoardWireCard
  /** In a stage where work is under way: draw progress and comments instead of project and date. */
  started: boolean
  onOpen: (card: TaskBoardWireCard) => void
  onMove: (card: TaskBoardWireCard) => void
  /** ▶︎/⏹ and the run's progress; null on a host without task start. */
  runActions: TaskBoardRunActions | null
}

type CardAction = { name: string; label: string; run: () => void }

/** One board card: tap opens it, a long press moves it, ▶︎/⏹ start or stop its orchestrator. */
export const MobileTaskBoardCard = memo(function MobileTaskBoardCard({
  card,
  started,
  onOpen,
  onMove,
  runActions
}: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const priority = cardPriorityLabel(card)
  const updated = formatUpdatedAt(card.updatedAt)
  // Hosts without task start send no `taskStart` at all.
  const runControls = runActions && card.taskStart !== undefined ? runActions : null
  const pending = runControls?.pendingRefKeys.has(card.refKey) ?? false
  const run = card.taskStart ?? null
  const running = run !== null && isTaskStartRunExclusive(run)
  // The card is one button to a screen reader; its inner buttons are reached as actions.
  const actions: CardAction[] = [
    { name: 'move', label: t('tasks.board.card.move', 'Move'), run: () => onMove(card) }
  ]
  if (runControls && !pending) {
    actions.push(
      running
        ? {
            name: 'stop',
            label: t('tasks.board.start.stopAction', 'Stop'),
            run: () => runControls.onStop(card)
          }
        : {
            name: 'start',
            label: t('tasks.board.start.startAction', 'Start'),
            run: () => runControls.onStart(card)
          }
    )
  }
  if (runControls && run && (run.orchestrator?.worktreeId ?? run.worktreeId)) {
    actions.push({
      name: 'openRun',
      label: t('tasks.board.start.openRunAction', 'Open the orchestrator'),
      run: () => runControls.onOpenRun(card)
    })
  }
  return (
    <Pressable
      onPress={() => onOpen(card)}
      onLongPress={() => onMove(card)}
      accessibilityRole="button"
      accessibilityLabel={cardAccessibilityLabel(card, started, t)}
      // A long press is out of reach for a screen reader; the move is its own action.
      accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
      onAccessibilityAction={(event) => {
        actions.find((action) => action.name === event.nativeEvent.actionName)?.run()
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <TaskProviderLogo provider={card.provider} size={14} color={colors.textSecondary} />
        <Text style={styles.displayId} numberOfLines={1}>
          {card.displayId}
        </Text>
        {priority ? (
          <Text style={styles.priority} numberOfLines={1}>
            {priority}
          </Text>
        ) : null}
        <View style={styles.headerSpacer} />
        {started && updated ? <Text style={styles.updatedAt}>{updated}</Text> : null}
        {runControls ? (
          <CardRunButton
            card={card}
            pending={pending}
            onStart={() => runControls.onStart(card)}
            onStop={() => runControls.onStop(card)}
          />
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {card.title}
      </Text>
      {runControls && run ? (
        <CardRunProgress run={run} onOpen={() => runControls.onOpenRun(card)} />
      ) : null}
      {started ? (
        <>
          <CardProgress card={card} />
          <CardComment card={card} />
        </>
      ) : (
        <Text style={styles.meta} numberOfLines={1}>
          {updated ? `${card.projectLabel} · ${updated}` : card.projectLabel}
        </Text>
      )}
    </Pressable>
  )
})
