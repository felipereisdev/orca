import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { GitBranch } from 'lucide-react-native'
import type {
  TaskBoardProgress,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import { TaskProviderLogo } from '../../components/TaskProviderLogo'
import type { Translate } from '../../i18n/mobile-i18n'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { getLinearPriorityLabel } from '../hosted-review/mobile-tasks-hosted-review'
import { formatUpdatedAt } from '../item-detail/mobile-tasks-item-mapping'
import { cardStyles as styles } from './mobile-task-board-card-styles'

type StepState = 'done' | 'failed' | 'pending'

// The host labels Linear priority in English; relabel from the number, as the Linear list does.
function cardPriorityLabel(card: TaskBoardWireCard): string | undefined {
  if (card.source.provider !== 'linear') {
    return card.priorityLabel
  }
  const { priority } = card.source.item
  return typeof priority === 'number' && priority > 0 ? getLinearPriorityLabel(priority) : undefined
}

function progressSteps(progress: TaskBoardProgress | null | undefined): StepState[] {
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
function reviewLabel(card: TaskBoardWireCard, t: Translate): string {
  const url = card.progress?.review?.url
  const pullRequest = url ? url.includes('/pull/') : card.provider === 'github'
  return pullRequest ? t('tasks.board.card.stepPr', 'PR') : t('tasks.board.card.stepMr', 'MR')
}

function ChecksText({ card, review }: { card: TaskBoardWireCard; review: string }) {
  const t = useMobileTranslation()
  const progress = card.progress
  if (!progress) {
    return null
  }
  switch (progress.checks) {
    case 'success':
      return (
        <Text style={[styles.checks, { color: colors.statusGreen }]}>
          {t('tasks.board.card.checksPassed', 'Checks passed')}
        </Text>
      )
    case 'failure':
      return (
        <Text style={[styles.checks, { color: colors.statusRed }]}>
          {t('tasks.board.card.checksFailed', 'Checks failed')}
        </Text>
      )
    case 'pending':
      return (
        <Text style={[styles.checks, { color: colors.statusAmber }]}>
          {t('tasks.board.card.checksRunning', 'Checks running')}
        </Text>
      )
    case 'none':
      return progress.review ? null : (
        <Text style={[styles.checks, { color: colors.textMuted }]}>
          {t('tasks.board.card.noReview', 'No {{review}} yet', { review })}
        </Text>
      )
  }
}

/** Workspace → commits → review → checks, then the branch and how its checks went. */
function CardProgress({ card }: { card: TaskBoardWireCard }) {
  const t = useMobileTranslation()
  const review = reviewLabel(card, t)
  const steps = progressSteps(card.progress)
  const labels = [
    t('tasks.board.card.stepWorkspace', 'Workspace'),
    t('tasks.board.card.stepCommits', 'Commits'),
    review,
    t('tasks.board.card.stepChecks', 'Checks')
  ]
  const done = steps.filter((step) => step === 'done').length
  return (
    <>
      <View
        style={styles.steps}
        accessible
        accessibilityLabel={t('tasks.board.card.stepsDone', '{{done}} of {{total}} steps done', {
          done,
          total: steps.length
        })}
      >
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

function unreadLabel(count: number, t: Translate): string {
  return count === 1
    ? t('tasks.board.card.unread_one', '{{count}} new', { count })
    : t('tasks.board.card.unread_other', '{{count}} new', { count })
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
      {unread > 0 ? <Text style={styles.unread}>{unreadLabel(unread, t)}</Text> : null}
    </View>
  )
}

type Props = {
  card: TaskBoardWireCard
  /** In a stage where work is under way: draw progress and comments instead of project and date. */
  started: boolean
  onOpen: (card: TaskBoardWireCard) => void
  onMove: (card: TaskBoardWireCard) => void
}

/** One board card: tap opens it, a long press moves it. */
export const MobileTaskBoardCard = memo(function MobileTaskBoardCard({
  card,
  started,
  onOpen,
  onMove
}: Props) {
  useMobileColorScheme()
  const priority = cardPriorityLabel(card)
  const updated = formatUpdatedAt(card.updatedAt)
  return (
    <Pressable
      onPress={() => onOpen(card)}
      onLongPress={() => onMove(card)}
      accessibilityRole="button"
      accessibilityLabel={`${card.displayId}, ${card.title}`}
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
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {card.title}
      </Text>
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
