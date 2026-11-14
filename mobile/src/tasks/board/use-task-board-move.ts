import { useRef, useState } from 'react'
import type {
  TaskBoardMoveFields,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { moveTaskBoardCard } from './task-board-operations'
import type { MobileTaskBoardChoice, MobileTaskBoardMoveResult } from './task-board-reply-schema'

// Each step owns its picks, so a new step or a way back never carries an earlier step's choice.
export type TaskBoardMoveStep =
  | { kind: 'targets'; targetId: string | null }
  | {
      kind: 'choice'
      targetColumnId: string
      choices: MobileTaskBoardChoice[]
      choiceId: string | null
    }
  | {
      kind: 'fields'
      targetColumnId: string
      choice: MobileTaskBoardChoice
      resolutionId: string | null
      comment: string
    }
  | { kind: 'unsupported'; choice: MobileTaskBoardChoice }

const START: TaskBoardMoveStep = { kind: 'targets', targetId: null }

/** The step's picks are complete: a column, a transition, or every required field. */
function isReady(step: TaskBoardMoveStep): boolean {
  switch (step.kind) {
    case 'targets':
      return step.targetId !== null
    case 'choice':
      return step.choiceId !== null
    case 'fields': {
      const fields = typeof step.choice.fields === 'object' ? step.choice.fields : null
      return (
        (!fields?.resolution?.required || step.resolutionId !== null) &&
        (!fields?.commentRequired || step.comment.trim().length > 0)
      )
    }
    case 'unsupported':
      return false
  }
}

export type BlockedReason = Extract<MobileTaskBoardMoveResult, { status: 'blocked' }>['reason']

export type TaskBoardMoveProblem =
  | { kind: 'blocked'; reason: BlockedReason }
  | { kind: 'failed'; error: string }
  // The request failed on the way, so the host may or may not have moved the card.
  | { kind: 'unconfirmed'; error: string }

type Params = {
  client: RpcClient | null
  offline: boolean
  card: TaskBoardWireCard
  onMoved: (targetColumnId: string, moved: TaskBoardWireCard | null) => void
  /** Reads the board again, to show where an unconfirmed move left the card. */
  onUnconfirmed: () => void
}

/** One card's move: the column, then whatever transition or fields the host asks for. */
export function useTaskBoardMove({ client, offline, card, onMoved, onUnconfirmed }: Params) {
  const [step, setStep] = useState<TaskBoardMoveStep>(START)
  const [problem, setProblem] = useState<TaskBoardMoveProblem | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const submit = async (
    targetColumnId: string,
    choice?: { choiceId: string; fields?: TaskBoardMoveFields }
  ): Promise<void> => {
    // Only the host moves cards: an offline phone never sends or queues one.
    if (offline || !client || inFlight.current) {
      return
    }
    inFlight.current = true
    setBusy(true)
    setProblem(null)
    try {
      const result = await moveTaskBoardCard(client, { ref: card.ref, targetColumnId, ...choice })
      switch (result.status) {
        case 'moved':
          onMoved(targetColumnId, result.card)
          return
        case 'needs-choice':
          setStep({ kind: 'choice', targetColumnId, choices: result.choices, choiceId: null })
          return
        case 'needs-fields':
          setStep({
            kind: 'fields',
            targetColumnId,
            choice: result.choice,
            resolutionId: null,
            comment: ''
          })
          return
        case 'unsupported-fields':
          setStep({ kind: 'unsupported', choice: result.choice })
          return
        case 'blocked':
          // The column's transitions changed under the picked one: start again from the columns.
          if (result.reason === 'invalid-choice') {
            setStep(START)
          }
          setProblem({ kind: 'blocked', reason: result.reason })
          return
        case 'failed':
          setProblem({ kind: 'failed', error: result.error })
          return
      }
    } catch (error) {
      setProblem({
        kind: 'unconfirmed',
        error: error instanceof Error ? error.message : String(error)
      })
      onUnconfirmed()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const confirm = () => {
    switch (step.kind) {
      case 'targets':
        if (step.targetId) {
          void submit(step.targetId)
        }
        return
      case 'choice':
        if (step.choiceId) {
          void submit(step.targetColumnId, { choiceId: step.choiceId })
        }
        return
      case 'fields': {
        if (!isReady(step)) {
          return
        }
        const comment = step.comment.trim()
        void submit(step.targetColumnId, {
          choiceId: step.choice.id,
          fields: {
            ...(step.resolutionId ? { resolutionId: step.resolutionId } : {}),
            ...(comment ? { comment } : {})
          }
        })
        return
      }
      case 'unsupported':
        return
    }
  }

  const back = () => {
    setStep(START)
    setProblem(null)
  }

  return {
    step,
    problem,
    busy,
    ready: isReady(step),
    confirm,
    back,
    pickTarget: (targetId: string) =>
      setStep((current) => (current.kind === 'targets' ? { ...current, targetId } : current)),
    pickChoice: (choiceId: string) =>
      setStep((current) => (current.kind === 'choice' ? { ...current, choiceId } : current)),
    pickResolution: (resolutionId: string) =>
      setStep((current) => (current.kind === 'fields' ? { ...current, resolutionId } : current)),
    editComment: (comment: string) =>
      setStep((current) => (current.kind === 'fields' ? { ...current, comment } : current))
  }
}
