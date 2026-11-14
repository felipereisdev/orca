import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { ChevronLeft, List, RefreshCw, SlidersHorizontal } from 'lucide-react-native'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import { HostOfflineBanner, useHostOfflineBanner } from '../../components/HostOfflineBanner'
import { MobileSegmentedControl } from '../../components/MobileSegmentedControl'
import { FilterChip } from '../../components/nav-bar/FilterChip'
import { NavBar } from '../../components/nav-bar/NavBar'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { StatusDot } from '../../components/StatusDot'
import { useHostProfile } from '../../host-catalog/use-host-profile'
import { useHostDisplay } from '../../host-descriptors/use-host-display'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useRouteHandoff } from '../../navigation/route-handoff'
import { useRefreshHint } from '../../query/refresh-hint'
import { saveTasksSurface } from '../../storage/preferences'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostConnectionInputs } from '../../transport/connection/client-context-connection-metrics'
import {
  classifyConnection,
  isConnectionOutage
} from '../../transport/connection/connection-health'
import { useForceReconnect, useHostClient } from '../../transport/connection/host-client-hooks'
import { mobileTaskListsHref } from '../mobile-task-navigation'
import { MobileTasksHostSubtitle } from '../screen/mobile-tasks-host-subtitle'
import { MobileTaskBoardBody } from './MobileTaskBoardBody'
import { MobileTaskBoardFilterSheet } from './MobileTaskBoardFilterSheet'
import {
  NO_TASK_BOARD_FILTER,
  taskBoardFilterCount,
  taskBoardStages,
  type TaskBoardFilter
} from './task-board-stages'
import { useTaskBoard } from './use-task-board'

// The detail drawer and move sheet (Task 11) take these presses over.
function ignoreCardPress(_card: TaskBoardWireCard): void {}

/** My board: the host's Kanban of issues assigned to the user, one stage at a time. */
export function MobileTaskBoardScreen() {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouteHandoff()
  const insets = useSafeAreaInsets()
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  // Only the board's own read: the provider lists' hydration and queries stay closed here.
  const { client, state: connState } = useHostClient(hostId)
  const connectionInputs = useHostConnectionInputs(hostId)
  const forceReconnect = useForceReconnect()
  const hostName = useHostDisplay(useHostProfile(hostId)).title
  const view = useTaskBoard(hostId)
  const [filter, setFilter] = useState<TaskBoardFilter>(NO_TASK_BOARD_FILTER)
  const [stageId, setStageId] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  const verdict = classifyConnection({ state: connState, ...connectionInputs })
  const reconnect = hostId && forceReconnect ? () => void forceReconnect(hostId) : null
  const board = view.unsupported ? undefined : view.data
  const stages = useMemo(() => (board ? taskBoardStages(board, filter) : []), [board, filter])
  const stage = stages.find((candidate) => candidate.id === stageId) ?? stages[0]
  const filterCount = taskBoardFilterCount(filter)
  // While first connecting the header's refresh line says so; offline is only a judged outage or a dropped link.
  const unreachable =
    connState !== 'connected' &&
    (connectionInputs.lastConnectedAt !== null || isConnectionOutage(verdict))
  const offlineBanner = useHostOfflineBanner({
    client,
    connState,
    lastConnectedAt: connectionInputs.lastConnectedAt,
    outage: isConnectionOutage(verdict),
    forceReconnect: reconnect,
    hasData: board !== undefined,
    asOf: view.readAt
  })
  const showRefreshLine = useRefreshHint(
    board !== undefined && (view.isRefreshing || (view.isOffline && offlineBanner === null))
  )

  const openLists = () => {
    void saveTasksSurface('lists').then(() => router.replace(mobileTaskListsHref(hostId)))
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <NavBar
        leading={
          <NavBarButton
            icon={ChevronLeft}
            onPress={() => router.back()}
            accessibilityLabel={t('common.back', 'Back')}
          />
        }
        title={t('tasks.board.screen.title', 'My board')}
        subtitle={
          <>
            <StatusDot state={connState} verdict={verdict} />
            <MobileTasksHostSubtitle hostId={hostId} />
          </>
        }
        trailing={
          <>
            <View>
              <NavBarButton
                icon={SlidersHorizontal}
                active={filterCount > 0}
                disabled={board === undefined}
                onPress={() => setFilterOpen(true)}
                accessibilityLabel={
                  filterCount > 0
                    ? t('tasks.board.screen.filtersActive', 'Filters, {{count}} active', {
                        count: filterCount
                      })
                    : t('tasks.board.screen.filters', 'Filters')
                }
              />
              {filterCount > 0 ? (
                <View style={styles.badge} pointerEvents="none">
                  <Text style={styles.badgeText}>{filterCount}</Text>
                </View>
              ) : null}
            </View>
            <NavBarButton
              icon={RefreshCw}
              disabled={view.isOffline || view.isRefreshing}
              onPress={() => void view.refresh()}
              accessibilityLabel={t('tasks.board.screen.refresh', 'Refresh board')}
            />
          </>
        }
        accessory={
          <View style={styles.accessory}>
            <View style={styles.toolbar}>
              <FilterChip
                label={t('tasks.board.screen.providerLists', 'Provider lists')}
                icon={List}
                onPress={openLists}
              />
            </View>
            {stages.length > 0 ? (
              <MobileSegmentedControl
                segments={stages.map((candidate) => ({
                  value: candidate.id,
                  label: `${candidate.label} · ${String(candidate.cards.length)}`
                }))}
                selected={stage?.id}
                onSelect={setStageId}
                tabs
                scrollWhenCrowded
                testIDPrefix="mobile-task-board-stage-"
                style={styles.stages}
              />
            ) : null}
          </View>
        }
        refreshing={showRefreshLine}
      />
      <MobileTaskBoardBody
        view={view}
        stages={stages}
        stage={stage}
        onSelectStage={setStageId}
        filtered={filterCount > 0}
        onClearFilter={() => setFilter(NO_TASK_BOARD_FILTER)}
        unreachable={unreachable}
        onReconnect={reconnect}
        banner={
          offlineBanner ? (
            <View style={styles.banner}>
              <HostOfflineBanner
                hostName={hostName}
                offline={offlineBanner.offline}
                asOf={offlineBanner.asOf}
                onRetry={offlineBanner.retry}
              />
            </View>
          ) : null
        }
        bottomInset={insets.bottom}
        onOpenCard={ignoreCardPress}
        onMoveCard={ignoreCardPress}
      />
      {board ? (
        <MobileTaskBoardFilterSheet
          visible={filterOpen}
          onClose={() => setFilterOpen(false)}
          board={board}
          filter={filter}
          onChange={setFilter}
        />
      ) : null}
    </SafeAreaView>
  )
}

const styles = themedStyleSheet(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  accessory: {
    gap: spacing.xs
  },
  // Content-sized, so the lone chip keeps its own width instead of filling the row.
  toolbar: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    paddingHorizontal: spacing.md
  },
  stages: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgPanel
  },
  banner: {
    paddingHorizontal: spacing.lg
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBlue
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onAccent
  }
}))
