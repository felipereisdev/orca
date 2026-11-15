import { Text, View } from 'react-native'
import { WifiOff } from 'lucide-react-native'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import { isTaskStartRunExclusive } from '../../../../src/shared/task-board/task-start-run'
import { MessageBox } from '../../components/composer-input/MessageBox'
import { ListGroup, ListRow, SectionHeader } from '../../components/list/ListGroup'
import { MobileMarkdown } from '../../components/MobileMarkdown'
import { MobileLoadErrorState, MobileStateView } from '../../components/MobileStateView'
import { SheetHeader } from '../../components/nav-bar/SheetHeader'
import type { Translate } from '../../i18n/mobile-i18n'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { colors, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { formatUpdatedAt } from '../item-detail/mobile-tasks-item-mapping'
import { MobileTaskBoardProgressTimeline } from './MobileTaskBoardProgressTimeline'
import {
  useTaskBoardDetail,
  type TaskBoardCommentSend,
  type TaskBoardDetailRead
} from './use-task-board-detail'

type Props = {
  card: TaskBoardWireCard
  /** In a column where work is under way: the host reads progress for these cards. */
  started: boolean
  client: RpcClient | null
  connected: boolean
  open: boolean
  onSeen: () => void
  onMove: () => void
  /** "Start as…" for this card; null on a host without task start. */
  onStartAs: (() => void) | null
  /** "Forget run" for a stop left unconfirmed; null on a host without task start. */
  onForgetRun: (() => void) | null
  onClose: () => void
}

function sendProblem(send: TaskBoardCommentSend, t: Translate): string | null {
  switch (send.status) {
    case 'idle':
    case 'sending':
      return null
    case 'failed':
      return t('tasks.board.detail.commentFailed', "Couldn't add the comment: {{error}}", {
        error: send.error
      })
    case 'unconfirmed':
      return t(
        'tasks.board.detail.commentUnconfirmed',
        "Couldn't confirm the comment was added ({{error}}). Check the comments before sending it again.",
        { error: send.error }
      )
  }
}

function Comments({
  read,
  connected,
  onRetry
}: {
  read: TaskBoardDetailRead
  connected: boolean
  onRetry: () => void
}) {
  const t = useMobileTranslation()
  if (read.status !== 'ready') {
    if (!connected) {
      return (
        <MobileStateView
          icon={WifiOff}
          title={t('tasks.board.detail.offline', 'Comments need the host')}
          message={t('tasks.board.detail.offlineMessage', 'Reconnect to read and add comments.')}
        />
      )
    }
    return read.status === 'error' ? (
      <MobileLoadErrorState
        error={new Error(read.message)}
        title={t('tasks.board.detail.loadFailed', "Couldn't load comments")}
        onRetry={onRetry}
      />
    ) : (
      <MobileStateView loading title={t('tasks.board.detail.loading', 'Loading comments…')} />
    )
  }
  const { comments } = read.detail
  if (comments.length === 0) {
    return <Text style={styles.muted}>{t('tasks.board.detail.noComments', 'No comments yet')}</Text>
  }
  return (
    <View style={styles.comments}>
      {comments.map((comment) => {
        const when = formatUpdatedAt(comment.at)
        return (
          <View key={comment.id} style={styles.comment}>
            <Text style={styles.byline} numberOfLines={1}>
              <Text style={styles.author}>{comment.author}</Text>
              {when ? ` · ${when}` : ''}
            </Text>
            <MobileMarkdown content={comment.body} />
          </View>
        )
      })}
    </View>
  )
}

/** One card: its progress, its comments with a composer, and the way to move it. */
export function MobileTaskBoardDetailDrawer({
  card,
  started,
  client,
  connected,
  open,
  onSeen,
  onMove,
  onStartAs,
  onForgetRun,
  onClose
}: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const detail = useTaskBoardDetail({ client, connected, card, open, onSeen })
  const shown = detail.read.status === 'ready' ? detail.read.detail : null
  const problem = sendProblem(detail.send, t)
  const sending = detail.send.status === 'sending'
  const commentCount = shown?.comments.length
  return (
    <>
      <SheetHeader
        title={card.displayId}
        subtitle={card.statusName}
        leading={{ label: t('tasks.board.card.move', 'Move'), onPress: onMove }}
        onClose={onClose}
      />
      <View style={styles.summary}>
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {card.projectLabel}
        </Text>
      </View>
      {onStartAs && !(card.taskStart && isTaskStartRunExclusive(card.taskStart)) ? (
        <ListGroup style={styles.actions}>
          <ListRow
            title={t('tasks.board.start.startAs', 'Start as…')}
            navigates
            onPress={onStartAs}
          />
        </ListGroup>
      ) : null}
      {onForgetRun &&
      card.taskStart?.state === 'stopping' &&
      card.taskStart.failure === 'stop-unconfirmed' ? (
        <ListGroup style={styles.actions}>
          <ListRow
            title={t('tasks.board.start.forget', 'Forget run')}
            navigates
            onPress={onForgetRun}
          />
        </ListGroup>
      ) : null}
      {started ? (
        <MobileTaskBoardProgressTimeline
          provider={card.provider}
          progress={shown ? shown.progress : card.progress}
          enrichment={shown ? shown.enrichment : card.enrichment}
        />
      ) : null}
      <SectionHeader
        title={t('tasks.board.detail.comments', 'Comments')}
        trailing={commentCount ? String(commentCount) : undefined}
      />
      <Comments read={detail.read} connected={connected} onRetry={detail.reload} />
      <View style={styles.composer}>
        <MessageBox
          value={detail.draft}
          onChangeText={detail.setDraft}
          placeholder={t('tasks.board.detail.commentPlaceholder', 'Add a comment')}
          editable={!sending}
          onSend={() => void detail.sendComment()}
          canSend={connected && detail.draft.trim().length > 0}
          sending={sending}
          sendAccessibilityLabel={t('tasks.board.detail.sendComment', 'Send comment')}
        />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      </View>
    </>
  )
}

const styles = themedStyleSheet(() => ({
  summary: {
    gap: spacing.xs,
    paddingBottom: spacing.md
  },
  title: {
    fontSize: typography.titleSize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  muted: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  actions: {
    marginBottom: spacing.md
  },
  comments: {
    gap: spacing.md
  },
  comment: {
    gap: spacing.xs
  },
  byline: {
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  author: {
    fontWeight: '600',
    color: colors.textPrimary
  },
  composer: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  problem: {
    fontSize: typography.metaSize,
    color: colors.statusAmber
  }
}))
