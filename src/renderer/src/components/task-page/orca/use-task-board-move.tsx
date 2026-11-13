import React, { useRef, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { TaskBoardDropCheck } from '@/components/task-board/TaskBoard'
import {
  JiraBoardMoveDialog,
  type JiraBoardMovePrompt
} from '@/components/task-page/jira/task-page-jira-board-move-dialog'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import { resolveLabelProviderMove } from '@/lib/work-items/task-board/task-board-move-targets'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { classifyTransitionRequirements } from '../../../../../shared/jira/jira-transition-fields'
import type {
  JiraIssue,
  JiraIssueUpdate,
  JiraTransition
} from '../../../../../shared/jira/jira-types'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import type { LinearWorkflowState } from '../../../../../shared/linear/workspace-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { TaskBoardSettings } from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { TaskBoardChoiceDialog } from './TaskBoardChoiceDialog'
import {
  applyJiraTaskBoardMove,
  applyLinearTaskBoardMove,
  applyTaskBoardLabelMove,
  loadJiraTaskBoardMoveTransitions,
  loadLinearTaskBoardMoveStates,
  requireTaskBoardTarget,
  taskBoardMoveErrorMessage
} from './task-board-provider-moves'

/** A drop waiting on the user's choice in a dialog; its card stays updating until it settles. */
type MoveSession = { card: TaskBoardCard; target: RuntimeClientTarget }
type LinearChoice = {
  issue: LinearIssue
  destination: string
  states: LinearWorkflowState[]
  error: string | null
}

export type TaskBoardMove = {
  canDrop: (card: TaskBoardCard, columnId: string) => TaskBoardDropCheck
  move: (card: TaskBoardCard, columnId: string) => Promise<void>
  updatingRefKeys: ReadonlySet<string>
  dialogs: React.JSX.Element
  error: string | null
  clearError: () => void
}

/** `accountHostId` routes Jira and Linear writes: pass the Tasks page's `accountBackedTaskSourceHostId`. */
export function useTaskBoardMove(args: {
  columns: readonly WorkspaceStatusDefinition[]
  settings: TaskBoardSettings
  accountHostId: ExecutionHostId
  onMoved: (provider: TaskProvider) => void
}): TaskBoardMove {
  const t = useTranslate()
  const [updatingRefKeys, setUpdatingRefKeys] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [jiraPrompt, setJiraPrompt] = useState<JiraBoardMovePrompt | null>(null)
  const [linearChoice, setLinearChoice] = useState<LinearChoice | null>(null)
  const [pending, setPending] = useState(false)
  // Why: state lags a render; a ref stops a second drop of the same card before it re-renders.
  const busyRef = useRef(new Set<string>())
  const sessionRef = useRef<MoveSession | null>(null)

  const setUpdating = (refKey: string, updating: boolean): void => {
    if (updating) {
      busyRef.current.add(refKey)
    } else {
      busyRef.current.delete(refKey)
    }
    setUpdatingRefKeys(new Set(busyRef.current))
  }
  const targetArgs = (columnId: string) => ({
    columnId,
    columnLabel: args.columns.find((column) => column.id === columnId)?.label ?? columnId,
    columns: args.columns,
    settings: args.settings
  })

  function openSession(session: MoveSession): void {
    const previous = sessionRef.current
    if (previous && previous.card.refKey !== session.card.refKey) {
      setUpdating(previous.card.refKey, false)
    }
    setJiraPrompt(null)
    setLinearChoice(null)
    sessionRef.current = session
  }

  function endSession(moved: boolean): void {
    const session = sessionRef.current
    sessionRef.current = null
    setJiraPrompt(null)
    setLinearChoice(null)
    if (session) {
      setUpdating(session.card.refKey, false)
      if (moved) {
        args.onMoved(session.card.provider)
      }
    }
  }

  function closeDialogs(): void {
    if (!pending) {
      endSession(false)
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

  /** Resolves true once the provider changed, false when a dialog now owns the move. */
  async function moveJira(
    card: TaskBoardCard,
    issue: JiraIssue,
    columnId: string
  ): Promise<boolean> {
    const target = requireTaskBoardTarget('jira', args.accountHostId)
    const moveArgs = targetArgs(columnId)
    const transitions = await loadJiraTaskBoardMoveTransitions(target, issue, moveArgs)
    const [only] = transitions
    if (transitions.length === 1 && classifyTransitionRequirements(only).kind === 'none') {
      await applyJiraTaskBoardMove(target, issue, only, { transitionId: only.id })
      return true
    }
    openSession({ card, target })
    setJiraPrompt({
      issue,
      destination: moveArgs.columnLabel,
      transitions,
      selected: transitions.length === 1 ? only : null,
      error: null,
      loading: false
    })
    return false
  }

  async function moveLinear(
    card: TaskBoardCard,
    issue: LinearIssue,
    columnId: string
  ): Promise<boolean> {
    const target = requireTaskBoardTarget('linear', args.accountHostId)
    const moveArgs = targetArgs(columnId)
    const states = await loadLinearTaskBoardMoveStates(target, issue, moveArgs)
    if (states.length === 1) {
      await applyLinearTaskBoardMove(target, issue, states[0])
      return true
    }
    openSession({ card, target })
    setLinearChoice({ issue, destination: moveArgs.columnLabel, states, error: null })
    return false
  }

  async function moveWithLabels(card: TaskBoardCard, columnId: string): Promise<boolean> {
    const labelMove = resolveLabelProviderMove(card, columnId, args.columns, args.settings)
    if (!labelMove.ok) {
      if (labelMove.reason === 'same-column') {
        return false
      }
      throw new Error(
        t('taskBoard.noLabelMapping', 'Map a label to this column in Settings → Tasks')
      )
    }
    await applyTaskBoardLabelMove(card, labelMove)
    return true
  }

  async function move(card: TaskBoardCard, columnId: string): Promise<void> {
    if (busyRef.current.has(card.refKey)) {
      return
    }
    setUpdating(card.refKey, true)
    setError(null)
    let moved = false
    try {
      const { source } = card
      moved =
        source.provider === 'jira'
          ? await moveJira(card, source.item, columnId)
          : source.provider === 'linear'
            ? await moveLinear(card, source.item, columnId)
            : await moveWithLabels(card, columnId)
    } catch (cause) {
      setError(taskBoardMoveErrorMessage(cause))
    }
    // An open dialog keeps the card updating until the user settles it.
    if (sessionRef.current?.card.refKey !== card.refKey) {
      setUpdating(card.refKey, false)
    }
    if (moved) {
      args.onMoved(card.provider)
    }
  }

  async function applyJira(transition: JiraTransition, updates: JiraIssueUpdate): Promise<void> {
    const session = sessionRef.current
    if (!session || !jiraPrompt) {
      return
    }
    setPending(true)
    try {
      await applyJiraTaskBoardMove(session.target, jiraPrompt.issue, transition, updates)
      endSession(true)
    } catch (cause) {
      setJiraPrompt((current) =>
        current
          ? { ...current, selected: transition, error: taskBoardMoveErrorMessage(cause) }
          : null
      )
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
    const session = sessionRef.current
    const state = linearChoice?.states.find((item) => item.id === stateId)
    if (!session || !linearChoice || !state) {
      return
    }
    setPending(true)
    try {
      await applyLinearTaskBoardMove(session.target, linearChoice.issue, state)
      endSession(true)
    } catch (cause) {
      setLinearChoice((current) =>
        current ? { ...current, error: taskBoardMoveErrorMessage(cause) } : null
      )
    }
    setPending(false)
  }

  const dialogs = (
    <>
      <JiraBoardMoveDialog
        prompt={jiraPrompt}
        pending={pending}
        onClose={closeDialogs}
        onChoose={(transition) => void chooseJira(transition)}
        onSubmit={async (updates) => {
          if (jiraPrompt?.selected) {
            await applyJira(jiraPrompt.selected, updates)
          }
        }}
        // Retry only shows for a prompt without transitions, which the board never opens.
        onRetry={closeDialogs}
      />
      <TaskBoardChoiceDialog
        open={linearChoice !== null}
        title={t('taskBoard.chooseStateTitle', 'Move {{id}} to {{column}}', {
          id: linearChoice?.issue.identifier,
          column: linearChoice?.destination
        })}
        description={t(
          'taskBoard.chooseStateDescription',
          'Several Linear states match this column. Choose one:'
        )}
        options={(linearChoice?.states ?? []).map((state) => ({ id: state.id, label: state.name }))}
        pending={pending}
        error={linearChoice?.error ?? null}
        onChoose={(stateId) => void chooseLinear(stateId)}
        onClose={closeDialogs}
      />
    </>
  )

  return {
    canDrop,
    move,
    updatingRefKeys,
    dialogs,
    error,
    clearError: () => setError(null)
  }
}
