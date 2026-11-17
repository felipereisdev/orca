import React, { useEffect, useRef, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { TaskBoardDropCheck } from '@/components/task-board/TaskBoard'
import type { JiraBoardMovePrompt } from '@/components/task-page/jira/boards/task-page-jira-board-move-dialog'
import type { TaskBoardMoveOverride } from '../../../../../shared/task-board/task-board-move-overrides'
import { moveTaskBoardCard } from '@/runtime/task-board/runtime-task-board-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import type { ExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type {
  TaskBoardChoice,
  TaskBoardMoveFields,
  TaskBoardMoveResult,
  TaskBoardWireCard
} from '../../../../../shared/task-board/task-board-wire-types'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { TaskBoardMoveDialogs, type TaskBoardStateChoice } from './TaskBoardMoveDialogs'
import {
  confirmTaskBoardMove,
  holdTaskBoardMove,
  isTaskBoardMoveInFlight,
  releaseTaskBoardMove,
  useTaskBoardMoveOverrides
} from './task-board-move-override-store'
import { taskBoardBlockedMessage, taskBoardMoveErrorMessage } from './task-board-move-messages'
import { withPreviousEnrichment } from './task-board-view-state'

/** One drop; while its dialog is open it is the board's only one. */
type MoveSession = {
  /** The board host at drop time; the hold lives in that host's board. */
  host: ExecutionHostId
  target: RuntimeClientTarget
  card: TaskBoardWireCard
  columnId: string
  columnLabel: string
}
type MoveRequest = { choiceId?: string; fields?: TaskBoardMoveFields }

export type TaskBoardMove = {
  canDrop: (card: TaskBoardWireCard, columnId: string) => TaskBoardDropCheck
  move: (card: TaskBoardWireCard, columnId: string) => Promise<void>
  /** Dropped cards held in their target column until a list agrees. */
  overrides: ReadonlyMap<string, TaskBoardMoveOverride>
  updatingRefKeys: ReadonlySet<string>
  dialogs: React.JSX.Element
  error: string | null
  clearError: () => void
}

/** Moves cards through the board host (`accountHostId`, the Tasks page's account-backed host). */
export function useTaskBoardMove(args: {
  columns: readonly WorkspaceStatusDefinition[]
  accountHostId: ExecutionHostId
  /** A fresh list; resolves once its result reached the board. */
  reread: () => Promise<void>
}): TaskBoardMove {
  const t = useTranslate()
  const { overrides, updatingRefKeys } = useTaskBoardMoveOverrides(args.accountHostId, args.reread)
  const [error, setError] = useState<string | null>(null)
  const [jiraPrompt, setJiraPrompt] = useState<JiraBoardMovePrompt | null>(null)
  const [stateChoice, setStateChoice] = useState<TaskBoardStateChoice | null>(null)
  const [pending, setPending] = useState(false)
  const dialogRef = useRef<MoveSession | null>(null)
  // A dialog dies with the board; its card must not stay held in the target column.
  useEffect(
    () => () => {
      if (dialogRef.current) {
        releaseTaskBoardMove(dialogRef.current.host, dialogRef.current.card.refKey)
      }
    },
    []
  )

  function closeDialog(session: MoveSession): void {
    if (dialogRef.current !== session) {
      return
    }
    dialogRef.current = null
    setJiraPrompt(null)
    setStateChoice(null)
  }

  function settleMoved(session: MoveSession, moved: TaskBoardWireCard | null): void {
    closeDialog(session)
    if (moved) {
      const confirmed = withPreviousEnrichment(moved, session.card)
      confirmTaskBoardMove(session.host, confirmed, moved.columnId)
      return
    }
    // Why: the write landed but its re-read failed; hold the card where it was dropped and list again.
    const held = { ...session.card, columnId: session.columnId }
    confirmTaskBoardMove(session.host, held, session.columnId)
    void args.reread()
  }

  /** An open dialog keeps its card held and shows the error; otherwise the card rolls back. */
  function fail(session: MoveSession, message: string): void {
    if (dialogRef.current === session) {
      setJiraPrompt((current) => (current ? { ...current, error: message } : null))
      setStateChoice((current) => (current ? { ...current, error: message } : null))
      return
    }
    releaseTaskBoardMove(session.host, session.card.refKey)
    setError(message)
  }

  function openDialog(
    session: MoveSession,
    choices: TaskBoardChoice[] | null,
    selected: TaskBoardChoice | null
  ): void {
    // One open dialog at a time, as the Jira tab locks its board: a second must not take it over.
    if (dialogRef.current && dialogRef.current !== session) {
      fail(session, t('taskBoard.finishOpenMove', 'Finish the open move first'))
      return
    }
    dialogRef.current = session
    if (session.card.provider !== 'jira') {
      setStateChoice({
        displayId: session.card.displayId,
        destination: session.columnLabel,
        choices: choices ?? [],
        error: null
      })
      return
    }
    setJiraPrompt((current) => ({
      issueKey: session.card.displayId,
      issueUrl: session.card.url,
      destination: session.columnLabel,
      choices: choices ?? current?.choices ?? (selected ? [selected] : []),
      selected,
      error: null,
      loading: false
    }))
  }

  function handle(session: MoveSession, result: TaskBoardMoveResult): void {
    switch (result.status) {
      case 'moved':
        return settleMoved(session, result.card)
      case 'needs-choice':
        return openDialog(session, result.choices, null)
      case 'needs-fields':
      case 'unsupported-fields':
        return openDialog(session, null, result.choice)
      case 'failed':
        return fail(session, result.error || taskBoardMoveErrorMessage(null))
      case 'blocked':
        if (result.reason !== 'same-column') {
          return fail(
            session,
            taskBoardBlockedMessage(result.reason, session.card, session.columnLabel)
          )
        }
        // The card already moved elsewhere (another client); the list shows where.
        closeDialog(session)
        releaseTaskBoardMove(session.host, session.card.refKey)
        void args.reread()
    }
  }

  async function send(session: MoveSession, request: MoveRequest): Promise<void> {
    try {
      const result = await moveTaskBoardCard(session.target, {
        ref: session.card.ref,
        targetColumnId: session.columnId,
        ...request
      })
      handle(session, result)
    } catch (cause) {
      fail(session, taskBoardMoveErrorMessage(cause))
    }
  }

  async function sendFromDialog(request: MoveRequest): Promise<void> {
    const session = dialogRef.current
    if (!session) {
      return
    }
    setPending(true)
    await send(session, request)
    setPending(false)
  }

  function closeDialogs(): void {
    const session = dialogRef.current
    if (!pending && session) {
      closeDialog(session)
      releaseTaskBoardMove(session.host, session.card.refKey)
    }
  }

  function canDrop(card: TaskBoardWireCard, columnId: string): TaskBoardDropCheck {
    const target = card.moveTargets.find((item) => item.columnId === columnId)
    if (target?.allowed !== false) {
      return { ok: true }
    }
    return {
      ok: false,
      reason: card.workItemStatus
        ? t(
            'taskBoard.noStatusOrLabelMapping',
            'Map a GitLab status or label to this column in Settings → Task Sources'
          )
        : t('taskBoard.noLabelMapping', 'Map a label to this column in Settings → Task Sources')
    }
  }

  async function move(card: TaskBoardWireCard, columnId: string): Promise<void> {
    const host = args.accountHostId
    if (isTaskBoardMoveInFlight(host, card.refKey)) {
      return
    }
    // Only Jira/Linear moves can open a dialog; a second one must wait for the open one.
    if ((card.provider === 'jira' || card.provider === 'linear') && dialogRef.current) {
      setError(t('taskBoard.finishOpenMove', 'Finish the open move first'))
      return
    }
    const target = ipcOrRuntimeTargetForHostId(host)
    if (!target) {
      setError(t('taskBoard.hostUnavailable', 'This host is not available.'))
      return
    }
    setError(null)
    // The card shows in its target column at once; a failure puts it back.
    holdTaskBoardMove(host, card, columnId)
    const columnLabel = args.columns.find((column) => column.id === columnId)?.label ?? columnId
    await send({ host, target, card, columnId, columnLabel }, {})
  }

  const dialogs = (
    <TaskBoardMoveDialogs
      jiraPrompt={jiraPrompt}
      stateChoice={stateChoice}
      pending={pending}
      onClose={closeDialogs}
      onChooseJira={(choice) => {
        setJiraPrompt((current) => (current ? { ...current, selected: choice, error: null } : null))
        // A choice with fields shows its form; the host applies it once they are filled.
        if (choice.fields === null) {
          void sendFromDialog({ choiceId: choice.id })
        }
      }}
      onSubmitJira={(submit) => sendFromDialog(submit)}
      onChooseState={(choiceId) => void sendFromDialog({ choiceId })}
    />
  )

  return {
    canDrop,
    move,
    overrides,
    updatingRefKeys,
    dialogs,
    error,
    clearError: () => setError(null)
  }
}
