import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { TaskBoardProviderState } from '@/lib/work-items/task-board/task-board-provider-results'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

export type TaskBoardToolbarProvider = {
  provider: TaskProvider
  label: string
  Icon: (props: { className?: string }) => React.JSX.Element
  state: TaskBoardProviderState
  shown: boolean
}

export function TaskBoardToolbar({
  providers,
  projectFilter,
  shownCount,
  refreshing,
  onToggleProvider,
  onRefresh
}: {
  providers: TaskBoardToolbarProvider[]
  projectFilter?: React.ReactNode
  shownCount: number
  refreshing: boolean
  onToggleProvider: (provider: TaskProvider) => void
  onRefresh: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex min-h-10 flex-none flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3 py-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {providers.map(({ provider, label, Icon, state, shown }) => {
          const tooltip =
            state.status === 'error'
              ? state.error
              : state.status === 'disconnected'
                ? t('taskBoard.providerUnavailable', '{{provider}} is not connected.', {
                    provider: label
                  })
                : label
          return (
            <Tooltip key={provider}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={shown}
                  onClick={() => onToggleProvider(provider)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition',
                    shown
                      ? 'border-foreground/30 bg-muted/70 text-foreground'
                      : 'border-dashed border-border/50 text-muted-foreground hover:text-foreground',
                    state.status === 'disconnected' && 'opacity-50'
                  )}
                >
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                  {state.status === 'error' ? (
                    <AlertTriangle className="size-3.5 text-status-warning-text" />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )
        })}
        {projectFilter}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-2xs text-muted-foreground">
        <span>
          {t('auto.components.TaskPage.shownCount', '{{count}} shown', {
            count: shownCount,
            defaultValue_one: '{{count}} shown'
          })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          aria-label={t('taskBoard.refresh', 'Refresh')}
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>
    </div>
  )
}
