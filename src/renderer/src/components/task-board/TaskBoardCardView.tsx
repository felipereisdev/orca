import React from 'react'
import { ArrowRight, ExternalLink, Gitlab, MoveRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { GitHubIcon } from '@/components/icons/GitHubIcon'
import { JiraIcon } from '@/components/icons/JiraIcon'
import { LinearIcon } from '@/components/icons/LinearIcon'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import type { TaskProvider } from '../../../../shared/work-items/task-providers'
import type { TaskBoardColumn, TaskBoardDropCheck } from './TaskBoard'

const PROVIDER_ICONS: Record<TaskProvider, (props: { className?: string }) => React.JSX.Element> = {
  github: ({ className }) => <GitHubIcon className={className} />,
  gitlab: ({ className }) => <Gitlab className={className} />,
  linear: ({ className }) => <LinearIcon className={className} />,
  jira: ({ className }) => <JiraIcon className={className} />
}

type TaskBoardCardViewProps = {
  card: TaskBoardCard
  columnId: string
  columns: TaskBoardColumn[]
  canDrop: (card: TaskBoardCard, columnId: string) => TaskBoardDropCheck
  dragging: boolean
  selected: boolean
  updating: boolean
  formatUpdatedAt: (updatedAt: string) => string
  onDragStart: (card: TaskBoardCard, event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onMove: (card: TaskBoardCard, columnId: string) => Promise<void>
  onOpen: (card: TaskBoardCard) => void
  onStartWorkspace: (card: TaskBoardCard) => void
}

export function TaskBoardCardView({
  card,
  columnId,
  columns,
  canDrop,
  dragging,
  selected,
  updating,
  formatUpdatedAt,
  onDragStart,
  onDragEnd,
  onMove,
  onOpen,
  onStartWorkspace
}: TaskBoardCardViewProps): React.JSX.Element {
  const t = useTranslate()
  const ProviderIcon = PROVIDER_ICONS[card.provider]
  const labels = card.labels.slice(0, 2)
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!updating}
      aria-current={selected ? 'true' : undefined}
      data-current={selected ? 'true' : undefined}
      aria-disabled={updating ? 'true' : undefined}
      onDragStart={(event) => onDragStart(card, event)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(card)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(card)
        }
      }}
      className={cn(
        'group/card cursor-pointer rounded-md border border-border/50 bg-background px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        !updating && 'cursor-grab active:cursor-grabbing',
        selected && 'bg-accent',
        dragging && 'opacity-50',
        updating && 'cursor-wait opacity-70'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">
            <ProviderIcon className="size-3 shrink-0" />
            <span className="truncate">{card.displayId}</span>
            {card.priorityLabel ? (
              <span className="truncate font-sans text-3xs">{card.priorityLabel}</span>
            ) : null}
          </div>
          <h3 className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {card.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={updating}
                aria-label={t('taskBoard.moveCard', 'Move {{id}}', { id: card.displayId })}
                onClick={(event) => event.stopPropagation()}
              >
                <MoveRight className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {columns
                .filter((target) => target.id !== columnId)
                .map((target) => {
                  const check = canDrop(card, target.id)
                  const item = (
                    <DropdownMenuItem
                      key={target.id}
                      disabled={!check.ok}
                      onClick={(event) => {
                        event.stopPropagation()
                        void onMove(card, target.id)
                      }}
                    >
                      {target.label}
                    </DropdownMenuItem>
                  )
                  if (check.ok) {
                    return item
                  }
                  return (
                    <Tooltip key={target.id}>
                      <TooltipTrigger asChild>
                        <span>{item}</span>
                      </TooltipTrigger>
                      <TooltipContent side="right">{check.reason}</TooltipContent>
                    </Tooltip>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(event) => {
                  event.stopPropagation()
                  onStartWorkspace(card)
                }}
                aria-label={t('taskBoard.startWorkspace', 'Start workspace from {{id}}', {
                  id: card.displayId
                })}
              >
                <ArrowRight className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('taskBoard.startWorkspaceTooltip', 'Start workspace')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(event) => {
                  event.stopPropagation()
                  openAppHttpLink(card.url, { event })
                }}
                aria-label={t('taskBoard.openExternal', 'Open {{id}} in browser', {
                  id: card.displayId
                })}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('taskBoard.openExternalTooltip', 'Open in browser')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {labels.length > 0 ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-1">
          {labels.map((label) => (
            <span
              key={label}
              className="max-w-[140px] truncate rounded-full border border-border/50 bg-muted/35 px-1.5 py-0.5 text-3xs text-muted-foreground"
            >
              {label}
            </span>
          ))}
          {card.labels.length > labels.length ? (
            <span className="text-3xs text-muted-foreground">
              +{card.labels.length - labels.length}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="truncate text-3xs">{card.projectLabel}</span>
        <span className="shrink-0">{formatUpdatedAt(card.updatedAt)}</span>
      </div>
    </div>
  )
}
