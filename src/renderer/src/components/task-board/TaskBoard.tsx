import React, { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  readTaskBoardCardDragData,
  writeTaskBoardCardDragData
} from '@/lib/work-items/task-board/task-board-drag-payload'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import type { WorkspaceStatusDefinition } from '../../../../shared/worktree/types'
import { getWorkspaceStatusVisualMeta } from '../sidebar/workspace-status/presentation/workspace-status'
import { TaskBoardCardView } from './TaskBoardCardView'

export type TaskBoardColumn = {
  id: string
  label: string
  status: WorkspaceStatusDefinition
  cards: TaskBoardCard[]
}
export type TaskBoardDropCheck = { ok: true } | { ok: false; reason: string }
export type TaskBoardProps = {
  columns: TaskBoardColumn[]
  canDrop: (card: TaskBoardCard, columnId: string) => TaskBoardDropCheck
  onMove: (card: TaskBoardCard, columnId: string) => Promise<void>
  onOpen: (card: TaskBoardCard) => void
  onStartWorkspace: (card: TaskBoardCard) => void
  updatingRefKeys: ReadonlySet<string>
  selectedRefKey: string | null
  formatUpdatedAt: (updatedAt: string) => string
}

export function TaskBoard({
  columns,
  canDrop,
  onMove,
  onOpen,
  onStartWorkspace,
  updatingRefKeys,
  selectedRefKey,
  formatUpdatedAt
}: TaskBoardProps): React.JSX.Element {
  const t = useTranslate()
  const [draggingRefKey, setDraggingRefKey] = useState<string | null>(null)
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null)

  const findCard = (refKey: string | null): TaskBoardCard | undefined =>
    refKey
      ? columns.flatMap((column) => column.cards).find((card) => card.refKey === refKey)
      : undefined
  const draggingCard = findCard(draggingRefKey)

  const handleCardDragStart = (
    card: TaskBoardCard,
    event: React.DragEvent<HTMLDivElement>
  ): void => {
    if (
      updatingRefKeys.has(card.refKey) ||
      !writeTaskBoardCardDragData(event.dataTransfer, card.refKey)
    ) {
      event.preventDefault()
      return
    }
    setDraggingRefKey(card.refKey)
  }

  const blockedReason = (columnId: string): string | null => {
    if (!draggingCard) {
      return null
    }
    const check = canDrop(draggingCard, columnId)
    return check.ok ? null : check.reason
  }

  const handleDragOver = (column: TaskBoardColumn, event: React.DragEvent<HTMLElement>): void => {
    if (!draggingCard || blockedReason(column.id) !== null) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverColumnId(column.id)
  }

  const handleDrop = (column: TaskBoardColumn, event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setDragOverColumnId(null)
    const payload = readTaskBoardCardDragData(event.dataTransfer)
    // Why: Electron can hide the payload on drop, so the dragging key is the fallback.
    const refKey =
      payload.status === 'card' && payload.refKey === draggingRefKey
        ? payload.refKey
        : payload.status === 'hidden'
          ? draggingRefKey
          : null
    const card = findCard(refKey)
    if (
      !card ||
      updatingRefKeys.has(card.refKey) ||
      column.cards.some((item) => item.refKey === card.refKey) ||
      !canDrop(card, column.id).ok
    ) {
      return
    }
    void onMove(card, column.id)
  }

  return (
    <div className="flex min-w-0 items-start gap-3 overflow-x-auto p-3 scrollbar-sleek">
      {columns.map((column) => {
        const meta = getWorkspaceStatusVisualMeta(column.status, t)
        const reason = blockedReason(column.id)
        return (
          <section
            key={column.id}
            onDragOver={(event) => handleDragOver(column, event)}
            onDrop={(event) => handleDrop(column, event)}
            className={cn(
              'w-72 shrink-0 rounded-md border border-border/50 bg-muted/20 transition-[border-color,box-shadow,opacity]',
              reason !== null && 'opacity-50',
              dragOverColumnId === column.id && 'border-ring/70 ring-1 ring-ring/70'
            )}
          >
            <Tooltip open={reason !== null}>
              <TooltipTrigger asChild>
                <div className="flex h-9 items-center justify-between border-b border-border/50 px-3">
                  <Badge variant="secondary" className="gap-1.5">
                    <meta.icon className={cn('size-3.5 shrink-0', meta.tone)} />
                    <span className="truncate">{column.label || '—'}</span>
                  </Badge>
                  <span className="text-2xs text-muted-foreground">{column.cards.length}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">{reason}</TooltipContent>
            </Tooltip>
            <div className="min-h-16 space-y-2 p-2">
              {column.cards.length === 0 ? (
                <div className="flex h-12 items-center justify-center rounded-md border border-dashed border-border/50 text-2xs text-muted-foreground">
                  {t('taskBoard.emptyColumn', 'No issues')}
                </div>
              ) : null}
              {column.cards.map((card) => (
                <TaskBoardCardView
                  key={card.refKey}
                  card={card}
                  columnId={column.id}
                  columns={columns}
                  canDrop={canDrop}
                  dragging={draggingRefKey === card.refKey}
                  selected={selectedRefKey === card.refKey}
                  updating={updatingRefKeys.has(card.refKey)}
                  formatUpdatedAt={formatUpdatedAt}
                  onDragStart={handleCardDragStart}
                  onDragEnd={() => {
                    setDraggingRefKey(null)
                    setDragOverColumnId(null)
                  }}
                  onMove={onMove}
                  onOpen={onOpen}
                  onStartWorkspace={onStartWorkspace}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
