import { useMemo } from 'react'
import { View } from 'react-native'
import {
  listTaskBoardProjects,
  type TaskBoardProjectOption
} from '../../../../src/shared/task-board/task-board-project-filter'
import type { TaskBoardListResult } from '../../../../src/shared/task-board/task-board-wire-types'
import { TASK_PROVIDERS, type TaskProvider } from '../../../../src/shared/work-items/task-providers'
import { BottomDrawer } from '../../components/bottom-drawer/BottomDrawer'
import { ListGroup, ListRow, SectionHeader } from '../../components/list/ListGroup'
import { FilterChip } from '../../components/nav-bar/FilterChip'
import { SheetHeader } from '../../components/nav-bar/SheetHeader'
import { SheetPrimaryButton } from '../../components/SheetPrimaryButton'
import { TaskProviderLogo } from '../../components/TaskProviderLogo'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { PROVIDER_LABELS } from '../task-list/mobile-task-view-options'
import {
  matchesTaskBoardFilter,
  NO_TASK_BOARD_FILTER,
  taskBoardFilterCount,
  type TaskBoardFilter
} from './task-board-stages'

type Props = {
  visible: boolean
  onClose: () => void
  board: TaskBoardListResult
  filter: TaskBoardFilter
  onChange: (filter: TaskBoardFilter) => void
}

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (!next.delete(value)) {
    next.add(value)
  }
  return next
}

/** Providers a person could pick: the ones the host reads, or that still have cards. */
function boardProviders(board: TaskBoardListResult): TaskProvider[] {
  return TASK_PROVIDERS.filter(
    (provider) =>
      board.providers[provider].status !== 'disconnected' ||
      board.cards.some((card) => card.provider === provider)
  )
}

/** Provider chips and per-project checks; the board narrows as they change. */
export function MobileTaskBoardFilterSheet({ visible, onClose, board, filter, onChange }: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const providers = boardProviders(board)
  // Projects of the picked providers only, so each count matches what the board would show.
  const projectsByProvider = useMemo(() => {
    const cards = board.cards.filter(
      (card) => filter.providers.size === 0 || filter.providers.has(card.provider)
    )
    const groups = new Map<TaskProvider, TaskBoardProjectOption[]>()
    for (const option of listTaskBoardProjects(cards, filter.projects)) {
      groups.set(option.provider, [...(groups.get(option.provider) ?? []), option])
    }
    return [...groups]
  }, [board.cards, filter])
  const shown = board.cards.filter((card) => matchesTaskBoardFilter(card, filter)).length

  const toggleProject = (option: TaskBoardProjectOption) => {
    const projects = new Map(filter.projects)
    if (!projects.delete(option.key)) {
      projects.set(option.key, { key: option.key, provider: option.provider, label: option.label })
    }
    onChange({ ...filter, projects })
  }

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <SheetHeader
        title={t('tasks.board.filter.title', 'Filters')}
        leading={{
          label: t('tasks.board.filter.clear', 'Clear'),
          onPress: () => onChange(NO_TASK_BOARD_FILTER),
          disabled: taskBoardFilterCount(filter) === 0
        }}
        onClose={onClose}
      />
      {providers.length > 1 ? (
        <>
          <SectionHeader title={t('tasks.board.filter.providers', 'Providers')} first />
          <View style={styles.chips}>
            {providers.map((provider) => (
              <FilterChip
                key={provider}
                label={PROVIDER_LABELS[provider]}
                active={filter.providers.has(provider)}
                onPress={() =>
                  onChange({ ...filter, providers: toggled(filter.providers, provider) })
                }
              />
            ))}
          </View>
        </>
      ) : null}
      {projectsByProvider.map(([provider, options]) => (
        <View key={provider}>
          <SectionHeader
            title={PROVIDER_LABELS[provider]}
            icon={<TaskProviderLogo provider={provider} size={13} color={colors.textSecondary} />}
          />
          <ListGroup>
            {options.map((option) => (
              <ListRow
                key={option.key}
                title={option.label}
                value={String(option.count)}
                selected={option.selected}
                accessibilityRole="checkbox"
                onPress={() => toggleProject(option)}
              />
            ))}
          </ListGroup>
        </View>
      ))}
      <View style={styles.footer}>
        <SheetPrimaryButton
          label={
            shown === 1
              ? t('tasks.board.filter.show_one', 'Show {{count}} task', { count: shown })
              : t('tasks.board.filter.show_other', 'Show {{count}} tasks', { count: shown })
          }
          onPress={onClose}
        />
      </View>
    </BottomDrawer>
  )
}

const styles = themedStyleSheet(() => ({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  footer: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  }
}))
