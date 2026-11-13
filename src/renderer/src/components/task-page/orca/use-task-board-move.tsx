import React, { useEffect, useRef, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { TaskBoardDropCheck } from '@/components/task-board/TaskBoard'
import type { JiraBoardMovePrompt } from '@/components/task-page/jira/task-page-jira-board-move-dialog'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import { resolveTaskBoardColumnId } from '@/lib/work-items/task-board/task-board-columns'
import type { TaskBoardMoveOverride } from '@/lib/work-items/task-board/task-board-move-overrides'
import { resolveLabelProviderMove } from '@/lib/work-items/task-board/task-board-move-targets'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { classifyTransitionRequirements } from '../../../../../shared/jira/jira-transition-fields'
import type {
  JiraIssue,
  JiraIssueUpdate,
  JiraTransition
} from '../../../../../shared/jira/jira-types'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { TaskBoardSettings } from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { TaskBoardMoveDialogs, type TaskBoardLinearChoice } from './TaskBoardMoveDialogs'
import { moveTaskBoardCardWithLabels } from './task-board-label-moves'
import {
  confirmTaskBoardMove,
  holdTaskBoardMove,
  isTaskBoardMoveInFlight,
  releaseTaskBoardMove,
  useTaskBoardMoveOverrides
} from './task-board-move-override-store'
import {
  applyJiraTaskBoardMove,
  applyLinearTaskBoardMove,
  loadJiraTaskBoardMoveTransitions,
  loadLinearTaskBoardMoveStates,
  requireTaskBoardTarget,
  taskBoardMoveErrorMessage
} from './task-board-provider-moves'

/** A Jira/Linear drop; while its dialog is open it is the board's only one. */
type MoveSession = {
  host: ExecutionHostId
  card: TaskBoardCard
  target: RuntimeClientTarget
  columnId: string
}
/** The confirmed card, no change, or `dialog`: a dialog now owns the move and its session. */
type MoveOutcome = TaskBoardCard | 'unchanged' | 'dialog'

export type TaskBoardMove = {
  canDrop: (card: TaskBoardCard, columnId: string) => TaskBoardDropCheck
  move: (card: TaskBoardCard, columnId: string) => Promise<void>
  /** Dropped cards held in their target column until a provider read agrees. */
  overrides: ReadonlyMap<string, TaskBoardMoveOverride>
  updatingRefKeys: ReadonlySet<string>
  dialogs: React.JSX.Element
  error: string | null
  clearError: () => void
}

/** `accountHostId` routes Jira and Linear writes: pass the Tasks page's `accountBackedTaskSourceHostId`. */
export function useTaskBoardMove(args: {
  /** The board's read cards; a GitLab/GitHub move reuses their label casing. */
  cards: readonly TaskBoardCard[]
  columns: readonly WorkspaceStatusDefinition[]
  settings: TaskBoardSettings
  accountHostId: ExecutionHostId
  /** A fresh read of the provider; resolves once its result reached the board. */
  reread: (provider: TaskProvider) => Promise<void>
}): TaskBoardMove {
  const t = useTranslate()
  const { overrides, updatingRefKeys } = useTaskBoardMoveOverrides(args.accountHostId, args.reread)
  const [error, setError] = useState<string | null>(null)
  const [jiraPrompt, setJiraPrompt] = useState<JiraBoardMovePrompt | null>(null)
  const [linearChoice, setLinearChoice] = useState<TaskBoardLinearChoice | null>(null)
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

  const targetArgs = (columnId: string) => ({
    columnId,
    columnLabel: args.columns.find((column) => column.id === columnId)?.label ?? columnId,
    columns: args.columns,
    settings: args.settings
  })

  /** `host` is the board host at drop time; the hold lives in that host's board. */
  function settle(
    { host, card, columnId }: Omit<MoveSession, 'target'>,
    outcome: TaskBoardCard | 'unchanged'
  ) {
    if (outcome === 'unchanged') {
      releaseTaskBoardMove(host, card.refKey)
      return
    }
    const confirmedColumnId = resolveTaskBoardColumnId(outcome, args.columns, args.settings)
    confirmTaskBoardMove(host, outcome, confirmedColumnId ?? columnId)
    void args.reread(card.provider)
  }

  /** Ends `session` only while it still owns the dialog; a settled session is never touched again. */
  function endDialog(session: MoveSession, outcome: TaskBoardCard | 'unchanged'): void {
    if (dialogRef.current !== session) {
      return
    }
    dialogRef.current = null
    setJiraPrompt(null)
    setLinearChoice(null)
    settle(session, outcome)
  }

  /** A drop whose choices loaded after another dialog opened gives way to that dialog. */
  function claimDialog(session: MoveSession): void {
    if (dialogRef.current) {
      throw new Error(t('taskBoard.finishOpenMove', 'Finish the open move first'))
    }
    dialogRef.current = session
  }

  function closeDialogs(): void {
    if (!pending && dialogRef.current) {
      endDialog(dialogRef.current, 'unchanged')
    }
  }

  function canDrop(card: TaskBoardCard, columnId: string): TaskBoardDropCheck {
    if (card.provider !== 'gitlab' && card.provider !== 'github') {
      return { ok: true }
    }
    const labelMove = resolveLabelProviderMove(card, columnId, args.columns, args.settings)
    // The board never offers a card's own column as a target; moving there is a no-op.
    return labelMove.ok || labelMove.reason === 'same-column'
      ? { ok: true }
      : {
          ok: false,
          reason: t('taskBoard.noLabelMapping', 'Map a label to this column in Settings → Tasks')
        }
  }

  async function moveJira(session: MoveSession, issue: JiraIssue): Promise<MoveOutcome> {
    const moveArgs = targetArgs(session.columnId)
    const transitions = await loadJiraTaskBoardMoveTransitions(session.target, issue, moveArgs)
    const [only] = transitions
    if (transitions.length === 1 && classifyTransitionRequirements(only).kind === 'none') {
      return applyJiraTaskBoardMove(session.target, session.card, issue, only, {
        transitionId: only.id
      })
    }
    claimDialog(session)
    setJiraPrompt({
      issue,
      destination: moveArgs.columnLabel,
      transitions,
      selected: transitions.length === 1 ? only : null,
      error: null,
      loading: false
    })
    return 'dialog'
  }

  async function moveLinear(session: MoveSession, issue: LinearIssue): Promise<MoveOutcome> {
    const moveArgs = targetArgs(session.columnId)
    const states = await loadLinearTaskBoardMoveStates(session.target, issue, moveArgs)
    if (states.length === 1) {
      return applyLinearTaskBoardMove(session.target, session.card, issue, states[0])
    }
    claimDialog(session)
    setLinearChoice({ issue, destination: moveArgs.columnLabel, states, error: null })
    return 'dialog'
  }

  async function move(card: TaskBoardCard, columnId: string): Promise<void> {
    const { source } = card
    const drop = { host: args.accountHostId, card, columnId }
    if (isTaskBoardMoveInFlight(drop.host, card.refKey)) {
      return
    }
    // One open dialog at a time, as the Jira tab locks its board: a second must not take it over.
    if ((source.provider === 'jira' || source.provider === 'linear') && dialogRef.current) {
      setError(t('taskBoard.finishOpenMove', 'Finish the open move first'))
      return
    }
    setError(null)
    // The card shows in its target column at once; a failure puts it back.
    holdTaskBoardMove(drop.host, card, columnId)
    let outcome: MoveOutcome = 'unchanged'
    try {
      const session = (provider: 'jira' | 'linear'): MoveSession => ({
        ...drop,
        target: requireTaskBoardTarget(provider, args.accountHostId)
      })
      outcome =
        source.provider === 'jira'
          ? await moveJira(session('jira'), source.item)
          : source.provider === 'linear'
            ? await moveLinear(session('linear'), source.item)
            : await moveTaskBoardCardWithLabels(card, {
                ...targetArgs(columnId),
                cards: args.cards
              })
    } catch (cause) {
      setError(taskBoardMoveErrorMessage(cause))
    }
    if (outcome !== 'dialog') {
      settle(drop, outcome)
    }
  }

  async function applyJira(transition: JiraTransition, updates: JiraIssueUpdate): Promise<void> {
    const session = dialogRef.current
    if (session?.card.source.provider !== 'jira') {
      return
    }
    setPending(true)
    try {
      const confirmed = await applyJiraTaskBoardMove(
        session.target,
        session.card,
        session.card.source.item,
        transition,
        updates
      )
      endDialog(session, confirmed)
    } catch (cause) {
      if (dialogRef.current === session) {
        setJiraPrompt((current) =>
          current
            ? { ...current, selected: transition, error: taskBoardMoveErrorMessage(cause) }
            : null
        )
      }
    }
    setPending(false)
  }

  async function chooseJira(transition: JiraTransition): Promise<void> {
    setJiraPrompt((current) => (current ? { ...current, selected: transition, error: null } : null))
    if (classifyTransitionRequirements(transition).kind === 'none') {
      await applyJira(transition, { transitionId: transition.id })
    }
  }

  async function chooseLinear(stateId: string): Promise<void> {
    const session = dialogRef.current
    const state = linearChoice?.states.find((item) => item.id === stateId)
    if (session?.card.source.provider !== 'linear' || !state) {
      return
    }
    setPending(true)
    try {
      const confirmed = await applyLinearTaskBoardMove(
        session.target,
        session.card,
        session.card.source.item,
        state
      )
      endDialog(session, confirmed)
    } catch (cause) {
      if (dialogRef.current === session) {
        setLinearChoice((current) =>
          current ? { ...current, error: taskBoardMoveErrorMessage(cause) } : null
        )
      }
    }
    setPending(false)
  }

  const dialogs = (
    <TaskBoardMoveDialogs
      jiraPrompt={jiraPrompt}
      linearChoice={linearChoice}
      pending={pending}
      onClose={closeDialogs}
      onChooseJira={(transition) => void chooseJira(transition)}
      onSubmitJira={applyJira}
      onChooseLinear={(stateId) => void chooseLinear(stateId)}
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
