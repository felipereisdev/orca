import React from 'react'
import { ChevronDown, Loader2, Play, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { isTaskStartRunExclusive } from '../../../../shared/task-board/task-start-run'
import type { TaskBoardWireCard } from '../../../../shared/task-board/task-board-wire-types'

function IconAction({
  label,
  tooltip,
  disabled,
  onClick,
  children
}: {
  label: string
  tooltip: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

/** ▶︎ with "Start as…" while the card has no exclusive run; ⏹ while one runs (again while stopping). */
export function TaskBoardCardStartButton({
  card,
  pending,
  onStart,
  onStartAs,
  onStop
}: {
  card: TaskBoardWireCard
  /** A start or stop request for this card is in flight. */
  pending: boolean
  onStart: (card: TaskBoardWireCard) => void
  onStartAs: (card: TaskBoardWireCard) => void
  onStop: (card: TaskBoardWireCard) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const run = card.taskStart
  // Hosts without task start send no `taskStart` at all.
  if (run === undefined) {
    return null
  }
  if (pending) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        disabled
        aria-label={t('taskStart.pending', 'Working on {{id}}…', { id: card.displayId })}
      >
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
      </Button>
    )
  }
  if (run && isTaskStartRunExclusive(run)) {
    const stopping = run.state === 'stopping'
    return (
      <IconAction
        label={
          stopping
            ? t('taskStart.stopAgainCard', 'Stop {{id}} again', { id: card.displayId })
            : t('taskStart.stopCard', 'Stop {{id}}', { id: card.displayId })
        }
        tooltip={stopping ? t('taskStart.stopAgain', 'Stop again') : t('taskStart.stop', 'Stop')}
        onClick={() => onStop(card)}
      >
        <Square className="size-3.5" />
      </IconAction>
    )
  }
  return (
    <ButtonGroup>
      <IconAction
        label={t('taskStart.startCard', 'Start {{id}}', { id: card.displayId })}
        tooltip={t('taskStart.start', 'Start task')}
        onClick={() => onStart(card)}
      >
        <Play className="size-3.5" />
      </IconAction>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="w-4"
            aria-label={t('taskStart.startOptions', 'Start options for {{id}}', {
              id: card.displayId
            })}
            onClick={(event) => event.stopPropagation()}
          >
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation()
              onStartAs(card)
            }}
          >
            {t('taskStart.startAs', 'Start as…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
