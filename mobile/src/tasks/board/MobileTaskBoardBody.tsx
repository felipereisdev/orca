import { useCallback, useState, type ReactNode } from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { CircleAlert, Inbox, Unplug } from 'lucide-react-native'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import { TASK_PROVIDERS } from '../../../../src/shared/work-items/task-providers'
import {
  MobileLoadErrorState,
  MobileNoMatchState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { PROVIDER_LABELS } from '../task-list/mobile-task-view-options'
import { MobileTaskBoardCard } from './MobileTaskBoardCard'
import { MobileTaskBoardSummary } from './MobileTaskBoardSummary'
import { taskBoardAllDisconnected, type TaskBoardStage } from './task-board-stages'
import type { TaskBoardView } from './use-task-board'

type Props = {
  view: TaskBoardView
  stages: readonly TaskBoardStage[]
  stage: TaskBoardStage | undefined
  onSelectStage: (stageId: string) => void
  filtered: boolean
  onClearFilter: () => void
  /** The host is judged unreachable, not merely still connecting. */
  unreachable: boolean
  onReconnect: (() => void) | null
  /** The offline banner over a board read earlier. */
  banner: ReactNode
  bottomInset: number
  onOpenCard: (card: TaskBoardWireCard) => void
  onMoveCard: (card: TaskBoardWireCard) => void
}

/** The board's body: a state while there is no board to draw, else the chosen stage's cards. */
export function MobileTaskBoardBody(props: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const { view, bottomInset } = props
  // Unsupported wins over a board an earlier launch stored: that host can no longer serve it.
  if (view.unsupported) {
    return (
      <MobileStateView
        icon={CircleAlert}
        title={t('tasks.board.screen.updateHost', 'Update Orca on the host to use My board')}
        bottomInset={bottomInset}
      />
    )
  }
  if (!view.data) {
    if (view.error) {
      return (
        <MobileLoadErrorState
          error={view.error}
          onRetry={() => void view.refresh()}
          bottomInset={bottomInset}
        />
      )
    }
    if (props.unreachable) {
      return <MobileOfflineState onReconnect={props.onReconnect} bottomInset={bottomInset} />
    }
    return (
      <MobileStateView
        loading
        title={t('tasks.board.screen.loading', 'Loading your board…')}
        bottomInset={bottomInset}
      />
    )
  }
  if (taskBoardAllDisconnected(view.data)) {
    return (
      <MobileStateView
        icon={Unplug}
        title={t('tasks.board.screen.noProvidersTitle', 'No task providers connected')}
        message={t(
          'tasks.board.screen.noProvidersMessage',
          'Connect Jira, Linear, GitLab or GitHub in Orca on the host to see your board.'
        )}
        bottomInset={bottomInset}
      />
    )
  }
  return <MobileTaskBoardList {...props} />
}

function MobileTaskBoardList({
  view,
  stages,
  stage,
  onSelectStage,
  filtered,
  onClearFilter,
  banner,
  bottomInset,
  onOpenCard,
  onMoveCard
}: Props) {
  const t = useMobileTranslation()
  const [pulling, setPulling] = useState(false)
  const pull = useCallback(() => {
    setPulling(true)
    void view.refresh().finally(() => setPulling(false))
  }, [view])
  const providers = view.data?.providers
  const failing = providers
    ? TASK_PROVIDERS.filter((provider) => providers[provider].status === 'error')
    : []
  const started = stage?.started ?? false
  const header = (
    <View style={styles.header}>
      {banner}
      {failing.length > 0 ? (
        <Text style={styles.notice}>
          {t('tasks.board.screen.providersFailed', "Couldn't read {{providers}}", {
            providers: failing.map((provider) => PROVIDER_LABELS[provider]).join(', ')
          })}
        </Text>
      ) : null}
      {view.error ? (
        <Text style={styles.notice} numberOfLines={2}>
          {t('tasks.board.screen.refreshFailed', "Couldn't refresh: {{message}}", {
            message: view.error.message
          })}
        </Text>
      ) : null}
      <MobileTaskBoardSummary stages={stages} onSelect={onSelectStage} />
    </View>
  )
  const empty = filtered ? (
    <MobileNoMatchState
      message={t('tasks.board.screen.noMatch', 'No tasks match these filters')}
      onClear={onClearFilter}
      bottomInset={bottomInset}
    />
  ) : (
    <MobileStateView
      icon={Inbox}
      title={t('tasks.board.screen.emptyStage', 'Nothing in {{stage}}', {
        stage: stage?.label ?? ''
      })}
      bottomInset={bottomInset}
    />
  )
  return (
    <FlatList
      data={stage?.cards ?? []}
      keyExtractor={(card) => card.refKey}
      renderItem={({ item }) => (
        <MobileTaskBoardCard
          card={item}
          started={started}
          onOpen={onOpenCard}
          onMove={onMoveCard}
        />
      )}
      ItemSeparatorComponent={CardGap}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: bottomInset + spacing.xl },
        (stage?.cards.length ?? 0) === 0 && styles.contentEmpty
      ]}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={pull}
          enabled={!view.isOffline}
          tintColor={colors.textSecondary}
        />
      }
    />
  )
}

function CardGap() {
  return <View style={styles.gap} />
}

const styles = themedStyleSheet(() => ({
  content: {
    paddingTop: spacing.sm
  },
  contentEmpty: {
    flexGrow: 1
  },
  header: {
    gap: spacing.sm,
    paddingBottom: spacing.md
  },
  notice: {
    paddingHorizontal: spacing.lg,
    fontSize: typography.metaSize,
    color: colors.statusAmber
  },
  gap: {
    height: spacing.sm
  }
}))
