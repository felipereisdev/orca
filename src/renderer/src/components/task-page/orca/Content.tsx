import React, { useMemo, useState } from 'react'
import { AlertCircle, KanbanSquare, X } from 'lucide-react'
import { TaskBoard, type TaskBoardColumn } from '@/components/task-board/TaskBoard'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import { resolveTaskBoardColumnId } from '@/lib/work-items/task-board/task-board-columns'
import type { TaskBoardCardsState } from '@/lib/work-items/task-board/task-board-provider-results'
import { useAppStore } from '@/store'
import {
  getDefaultTaskBoardSettings,
  type TaskBoardSettings
} from '../../../../../shared/task-board/task-board-settings'
import { isTaskProvider, type TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import type { SourceOption } from '../task-page-localized-options'
import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import { formatRelativeTime } from '../task-page-source-context'
import { TaskBoardToolbar, type TaskBoardToolbarProvider } from './TaskBoardToolbar'
import { useTaskBoardCards } from './use-task-board-cards'
import { useTaskBoardMove, type TaskBoardMove } from './use-task-board-move'
import {
  readHiddenTaskBoardProviders,
  writeHiddenTaskBoardProviders
} from './task-board-session-cache'

export function TaskPageOrcaContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const {
    accountBackedTaskSourceHostId,
    sourceOptions,
    openJiraDetailPage,
    handleUseJiraItem,
    openLinearDetailPage,
    handleOpenOrUseLinearItem,
    openGitLabDetailPage,
    handleUseGitLabItem,
    openGitHubDetailPage,
    handleOpenOrUseGitHubWorkItem
  } = model
  const statuses = useAppStore((s) => s.workspaceStatuses)
  const savedSettings = useAppStore((s) => s.settings?.taskBoard)
  // Why: a fallback built inside the selector would be a new object every render.
  const settings = useMemo(() => savedSettings ?? getDefaultTaskBoardSettings(), [savedSettings])
  const { state, refresh, refreshProvider } = useTaskBoardCards(accountBackedTaskSourceHostId)
  const move = useTaskBoardMove({
    columns: statuses,
    settings,
    accountHostId: accountBackedTaskSourceHostId,
    onMoved: refreshProvider
  })

  const openCard = (card: TaskBoardCard): void => {
    const { source } = card
    switch (source.provider) {
      case 'jira':
        return openJiraDetailPage(source.item)
      case 'linear':
        return openLinearDetailPage(source.item)
      case 'gitlab':
        return openGitLabDetailPage(source.item)
      case 'github':
        return openGitHubDetailPage(source.item)
    }
  }
  const startWorkspace = (card: TaskBoardCard): void => {
    const { source } = card
    switch (source.provider) {
      case 'jira':
        return handleUseJiraItem(source.item)
      case 'linear':
        return handleOpenOrUseLinearItem(source.item)
      case 'gitlab':
        return handleUseGitLabItem(source.item)
      case 'github':
        return handleOpenOrUseGitHubWorkItem(source.item)
    }
  }

  return (
    <TaskPageOrcaBoard
      state={state}
      statuses={statuses}
      settings={settings}
      move={move}
      sourceOptions={sourceOptions}
      onRefresh={refresh}
      onOpen={openCard}
      onStartWorkspace={startWorkspace}
    />
  )
}

/** The board without its data hooks, so fixtures can render every state. */
export function TaskPageOrcaBoard({
  state,
  statuses,
  settings,
  move,
  sourceOptions,
  onRefresh,
  onOpen,
  onStartWorkspace
}: {
  state: TaskBoardCardsState
  statuses: readonly WorkspaceStatusDefinition[]
  settings: TaskBoardSettings
  move: TaskBoardMove
  sourceOptions: readonly SourceOption[]
  onRefresh: () => void
  onOpen: (card: TaskBoardCard) => void
  onStartWorkspace: (card: TaskBoardCard) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [hiddenProviders, setHiddenProviders] = useState(readHiddenTaskBoardProviders)

  const columns = useMemo<TaskBoardColumn[]>(() => {
    const byId = new Map<string, TaskBoardColumn>(
      statuses.map((status) => [
        status.id,
        { id: status.id, label: status.label, status, cards: [] }
      ])
    )
    for (const card of state.cards) {
      if (hiddenProviders.has(card.provider)) {
        continue
      }
      const columnId = resolveTaskBoardColumnId(card, statuses, settings)
      if (columnId !== null) {
        byId.get(columnId)?.cards.push(card)
      }
    }
    return [...byId.values()]
  }, [hiddenProviders, settings, state.cards, statuses])

  const toolbarProviders = sourceOptions.flatMap((option): TaskBoardToolbarProvider[] =>
    isTaskProvider(option.id)
      ? [
          {
            provider: option.id,
            label: option.label,
            Icon: option.Icon,
            state: state.providers[option.id],
            shown: !hiddenProviders.has(option.id)
          }
        ]
      : []
  )
  const providerStates = Object.values(state.providers)
  const firstLoad = state.cards.length === 0 && providerStates.some((p) => p.status === 'loading')
  const refreshing = providerStates.some((p) => p.status === 'loading' || p.refreshing === true)
  const allDisconnected = providerStates.every((provider) => provider.status === 'disconnected')
  const toggleProvider = (provider: TaskProvider): void => {
    const next = new Set(hiddenProviders)
    if (!next.delete(provider)) {
      next.add(provider)
    }
    setHiddenProviders(next)
    writeHiddenTaskBoardProviders(next)
  }

  if (allDisconnected) {
    return (
      <div className="mt-3 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <KanbanSquare className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          {t('taskBoard.noProviders', 'Connect a task provider in Settings → Tasks')}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3 flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <TaskBoardToolbar
        providers={toolbarProviders}
        shownCount={columns.reduce((count, column) => count + column.cards.length, 0)}
        refreshing={refreshing}
        onToggleProvider={toggleProvider}
        onRefresh={onRefresh}
      />
      {move.error ? (
        <div
          role="alert"
          className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertCircle className="size-3.5 flex-none" />
          <span className="min-w-0 flex-1">{move.error}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={move.clearError}
            aria-label={t('taskBoard.dismissError', 'Dismiss')}
          >
            <X className="size-3" />
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        {firstLoad ? (
          <TaskBoardSkeleton columnCount={statuses.length} />
        ) : (
          <TaskBoard
            columns={columns}
            canDrop={move.canDrop}
            onMove={move.move}
            onOpen={onOpen}
            onStartWorkspace={onStartWorkspace}
            updatingRefKeys={move.updatingRefKeys}
            selectedRefKey={null}
            formatUpdatedAt={formatRelativeTime}
          />
        )}
      </div>
      {move.dialogs}
    </div>
  )
}

function TaskBoardSkeleton({ columnCount }: { columnCount: number }): React.JSX.Element {
  return (
    <div aria-busy className="flex min-w-0 items-start gap-3 overflow-hidden p-3">
      {Array.from({ length: Math.max(columnCount, 1) }, (_, column) => (
        <div key={column} className="w-72 shrink-0 rounded-md border border-border/50 bg-muted/20">
          <div className="flex h-9 items-center border-b border-border/50 px-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted/70" />
          </div>
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }, (_, card) => (
              <div key={card} className="h-16 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
