import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { ExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import type { TaskBoardStart } from './use-task-board-start'
import { taskStartPrimaryReasonMessage } from './task-board-start-messages'
import { TaskStartDialog } from './TaskStartDialog'

function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  description: string
  details?: string[]
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent size="compact">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {details && details.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('taskStart.dialog.cancel', 'Cancel')}
          </Button>
          <Button size="sm" variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function stopTitle(workers: number | null, t: Translate): string {
  if (workers === null || workers === 0) {
    return t('taskStart.stopConfirm.titleNoAgents', 'Stop the orchestrator?')
  }
  return t('taskStart.stopConfirm.title', 'Stop the orchestrator and {{count}} agents?', {
    count: workers,
    defaultValue_one: 'Stop the orchestrator and {{count}} agent?'
  })
}

/** "Start as…", the primary-checkout warning before a start, and the ⏹ confirmation. */
export function TaskBoardStartDialogs({
  start,
  hostId
}: {
  start: TaskBoardStart
  hostId: ExecutionHostId
}): React.JSX.Element {
  const t = useTranslate()
  const { primaryConfirm, stopConfirm, forgetConfirm } = start
  return (
    <>
      <TaskStartDialog
        state={start.dialog}
        hostId={hostId}
        onSubmit={start.submitDialog}
        onClose={start.closeDialog}
      />
      <ConfirmDialog
        open={primaryConfirm !== null}
        title={t('taskStart.primaryConfirm.title', 'Start {{id}} in the primary checkout?', {
          id: primaryConfirm?.card.displayId
        })}
        description={t(
          'taskStart.primaryConfirm.description',
          'The agents will work directly in the primary checkout.'
        )}
        details={(primaryConfirm?.reasons ?? []).map(taskStartPrimaryReasonMessage)}
        confirmLabel={t('taskStart.primaryConfirm.action', 'Start anyway')}
        onConfirm={start.confirmPrimary}
        onCancel={start.cancelPrimary}
      />
      <ConfirmDialog
        open={stopConfirm !== null}
        title={stopTitle(stopConfirm?.workers ?? null, t)}
        description={t(
          'taskStart.stopConfirm.description',
          'The worktree, its branch and commits stay as they are.'
        )}
        confirmLabel={t('taskStart.stop', 'Stop')}
        destructive
        onConfirm={start.confirmStop}
        onCancel={start.cancelStop}
      />
      <ConfirmDialog
        open={forgetConfirm !== null}
        title={t('taskStart.forgetConfirm.title', 'Forget the run of {{id}}?', {
          id: forgetConfirm?.displayId
        })}
        description={t(
          'taskStart.forgetConfirm.description',
          'Orca could not confirm that the orchestrator and its agents stopped. They may still be running; the card is freed to start again.'
        )}
        confirmLabel={t('taskStart.forget', 'Forget run')}
        destructive
        onConfirm={start.confirmForget}
        onCancel={start.cancelForget}
      />
    </>
  )
}
