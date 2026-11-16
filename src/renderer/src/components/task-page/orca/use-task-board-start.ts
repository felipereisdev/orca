import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import {
  startTask,
  stopTask,
  type TaskStartParams
} from '@/runtime/task-board/runtime-task-board-client'
import type { ExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { TaskStartRunSummary } from '../../../../../shared/task-board/task-start-run'
import type {
  TaskStartPrimaryReason,
  TaskBoardWireCard
} from '../../../../../shared/task-board/task-board-wire-types'
import type { TaskBoardRunActions } from '@/components/task-board/TaskBoard'
import { openTaskStartRun } from './task-board-run-open'
import { taskStartErrorMessage, taskStartFailureMessage } from './task-board-start-messages'

/** "Start as…" for a card; `repoRequired` when the host could not resolve its repository. */
export type TaskStartDialogState = {
  card: TaskBoardWireCard
  repoRequired: boolean
  pending: boolean
  error: string | null
}
export type TaskStartPrimaryConfirm = {
  card: TaskBoardWireCard
  params: Omit<TaskStartParams, 'ref' | 'confirmPrimary'>
  reasons: TaskStartPrimaryReason[]
}
/** `workers` is null when the preview could not count them. */
export type TaskStopConfirm = { card: TaskBoardWireCard; workers: number | null }

export type TaskBoardStart = {
  actions: TaskBoardRunActions
  dialog: TaskStartDialogState | null
  primaryConfirm: TaskStartPrimaryConfirm | null
  stopConfirm: TaskStopConfirm | null
  /** "Forget run" asked for a stop left unconfirmed. */
  forgetConfirm: TaskBoardWireCard | null
  submitDialog: (params: Omit<TaskStartParams, 'ref' | 'confirmPrimary'>) => void
  closeDialog: () => void
  confirmPrimary: () => void
  cancelPrimary: () => void
  confirmStop: () => void
  cancelStop: () => void
  confirmForget: () => void
  cancelForget: () => void
}

/** `finally` lives here because the React compiler cannot compile it inside a hook. */
async function settleAfter(work: () => Promise<void>, settle: () => void): Promise<void> {
  try {
    await work()
  } finally {
    settle()
  }
}

function hostUnavailable(): string {
  return translate('taskBoard.hostUnavailable', 'This host is not available.')
}

/** Starts, stops and opens task-start runs on the board host (`accountHostId`). */
export function useTaskBoardStart(args: {
  accountHostId: ExecutionHostId
  /** The host's list again, so the card shows the run's current state. */
  rereadRuns: () => void
}): TaskBoardStart {
  const { accountHostId, rereadRuns } = args
  const t = useTranslate()
  const [pendingRefKeys, setPendingRefKeys] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<TaskStartDialogState | null>(null)
  const [primaryConfirm, setPrimaryConfirm] = useState<TaskStartPrimaryConfirm | null>(null)
  const [stopConfirm, setStopConfirm] = useState<TaskStopConfirm | null>(null)
  const [forgetConfirm, setForgetConfirm] = useState<TaskBoardWireCard | null>(null)
  const pendingRef = useRef(new Set<string>())

  const setPending = (refKey: string, pending: boolean): void => {
    if (pending) {
      pendingRef.current.add(refKey)
    } else {
      pendingRef.current.delete(refKey)
    }
    setPendingRefKeys(new Set(pendingRef.current))
  }

  const targetOrToast = (): RuntimeClientTarget | null => {
    const target = ipcOrRuntimeTargetForHostId(accountHostId)
    if (!target) {
      toast.error(hostUnavailable())
    }
    return target
  }

  const openRun = (run: TaskStartRunSummary): void => {
    void openTaskStartRun(run, accountHostId).then((opened) => {
      if (!opened) {
        toast.error(
          t('taskStart.openRunFailed', 'The task workspace is not available in this window.')
        )
      }
    })
  }

  /** `fromDialog` keeps the dialog open to show an error the user can act on there. */
  const start = async (
    card: TaskBoardWireCard,
    params: Omit<TaskStartParams, 'ref'>,
    fromDialog: boolean
  ): Promise<void> => {
    const target = targetOrToast()
    if (!target || pendingRef.current.has(card.refKey)) {
      return
    }
    setPending(card.refKey, true)
    setDialog((current) =>
      current && fromDialog ? { ...current, pending: true, error: null } : current
    )
    await settleAfter(
      async () => {
        try {
          const result = await startTask(target, { ref: card.ref, ...params })
          if (result.ok) {
            setDialog(null)
            openRun(result.run)
            return
          }
          if (result.error === 'repo_unresolved') {
            setDialog({ card, repoRequired: true, pending: false, error: null })
            return
          }
          if (result.error === 'primary_needs_confirmation') {
            setDialog(null)
            const { confirmPrimary: _confirmed, ...rest } = params
            setPrimaryConfirm({ card, params: rest, reasons: result.reasons ?? [] })
            return
          }
          const message = taskStartErrorMessage(result.error, result.role)
          if (result.error === 'already_running' || result.error === 'primary_busy') {
            setDialog(null)
            toast.info(message)
            return
          }
          if (fromDialog) {
            setDialog((current) =>
              current ? { ...current, pending: false, error: message } : current
            )
            return
          }
          toast.error(message)
        } catch (cause) {
          const message = taskStartFailureMessage(
            cause,
            t('taskStart.error.startFailed', 'Could not start the task.')
          )
          if (fromDialog) {
            setDialog((current) =>
              current ? { ...current, pending: false, error: message } : current
            )
            return
          }
          toast.error(message)
        }
      },
      () => {
        setPending(card.refKey, false)
        rereadRuns()
      }
    )
  }

  const stop = async (card: TaskBoardWireCard, force = false): Promise<void> => {
    const target = targetOrToast()
    if (!target || pendingRef.current.has(card.refKey)) {
      return
    }
    setPending(card.refKey, true)
    await settleAfter(
      async () => {
        try {
          await stopTask(target, { ref: card.ref, ...(force ? { force } : {}) })
        } catch (cause) {
          toast.error(
            taskStartFailureMessage(
              cause,
              t('taskStart.error.stopFailed', 'Could not stop the task.')
            )
          )
        }
      },
      () => {
        setPending(card.refKey, false)
        rereadRuns()
      }
    )
  }

  const askStop = async (card: TaskBoardWireCard): Promise<void> => {
    // The user already confirmed this stop; a repeat retries what was left unproven.
    if (card.taskStart?.state === 'stopping') {
      await stop(card)
      return
    }
    const target = targetOrToast()
    if (!target || pendingRef.current.has(card.refKey)) {
      return
    }
    setPending(card.refKey, true)
    let workers: number | null = null
    await settleAfter(
      async () => {
        try {
          const preview = await stopTask(target, { ref: card.ref, preview: true })
          workers = preview.agents === undefined ? null : Math.max(0, preview.agents - 1)
        } catch {
          // The confirmation still opens; it just cannot name how many agents stop.
        }
      },
      () => setPending(card.refKey, false)
    )
    setStopConfirm({ card, workers })
  }

  return {
    actions: {
      onStart: (card) => void start(card, {}, false),
      onStartAs: (card) => setDialog({ card, repoRequired: false, pending: false, error: null }),
      onStop: (card) => void askStop(card),
      onForget: (card) => setForgetConfirm(card),
      onOpenRun: (card) => {
        if (card.taskStart) {
          openRun(card.taskStart)
        }
      },
      pendingRefKeys
    },
    dialog,
    primaryConfirm,
    stopConfirm,
    forgetConfirm,
    submitDialog: (params) => {
      if (dialog) {
        void start(dialog.card, params, true)
      }
    },
    closeDialog: () => setDialog((current) => (current?.pending ? current : null)),
    confirmPrimary: () => {
      if (primaryConfirm) {
        setPrimaryConfirm(null)
        void start(primaryConfirm.card, { ...primaryConfirm.params, confirmPrimary: true }, false)
      }
    },
    cancelPrimary: () => setPrimaryConfirm(null),
    confirmStop: () => {
      if (stopConfirm) {
        setStopConfirm(null)
        void stop(stopConfirm.card)
      }
    },
    cancelStop: () => setStopConfirm(null),
    confirmForget: () => {
      if (forgetConfirm) {
        setForgetConfirm(null)
        void stop(forgetConfirm, true)
      }
    },
    cancelForget: () => setForgetConfirm(null)
  }
}
