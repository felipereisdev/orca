import { useRef, useState } from 'react'
import type {
  TaskBoardMoveFields,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { moveTaskBoardCard } from './task-board-operations'
import type { MobileTaskBoardChoice, MobileTaskBoardMoveResult } from './task-board-reply-schema'

export type TaskBoardMoveStep =
  | { kind: 'targets' }
  | { kind: 'choice'; targetColumnId: string; choices: MobileTaskBoardChoice[] }
  | { kind: 'fields'; targetColumnId: string; choice: MobileTaskBoardChoice }
  | { kind: 'unsupported'; choice: MobileTaskBoardChoice }

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
  const [step, setStep] = useState<TaskBoardMoveStep>({ kind: 'targets' })
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
          setStep({ kind: 'choice', targetColumnId, choices: result.choices })
          return
        case 'needs-fields':
          setStep({ kind: 'fields', targetColumnId, choice: result.choice })
          return
        case 'unsupported-fields':
          setStep({ kind: 'unsupported', choice: result.choice })
          return
        case 'blocked':
          // The column's transitions changed under the picked one: start again from the columns.
          if (result.reason === 'invalid-choice') {
            setStep({ kind: 'targets' })
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

  const back = () => {
    setStep({ kind: 'targets' })
    setProblem(null)
  }

  return { step, problem, busy, submit, back }
}
