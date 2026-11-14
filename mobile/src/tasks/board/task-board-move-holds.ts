import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  finishTaskBoardMoveRereads,
  nextTaskBoardMoveExpiry,
  placeTaskBoardCards,
  startExpiredTaskBoardMoveRereads,
  TASK_BOARD_MOVE_OVERRIDE_TTL_MS,
  type TaskBoardMoveOverride
} from '../../../../src/shared/task-board/task-board-move-overrides'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'

type Holds = ReadonlyMap<string, TaskBoardMoveOverride>

// Module scope, so a move confirmed just before the board unmounted still holds its card when it returns.
const holdsByHost = new Map<string, Holds>()
const NO_HOLDS: Holds = new Map()
const listeners = new Set<() => void>()

function change(hostId: string, update: (next: Map<string, TaskBoardMoveOverride>) => void): void {
  const next = new Map(holdsByHost.get(hostId))
  update(next)
  holdsByHost.set(hostId, next)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Keeps a moved card in its target column while host lists still show the old status. */
export function holdTaskBoardMove(hostId: string, card: TaskBoardWireCard, columnId: string): void {
  const expiresAt = Date.now() + TASK_BOARD_MOVE_OVERRIDE_TTL_MS
  change(hostId, (next) => next.set(card.refKey, { card, columnId, expiresAt }))
}

/** A held card shows the held copy, so a change made after the move must reach it too. */
export function changeHeldTaskBoardCard(
  hostId: string,
  refKey: string,
  update: (card: TaskBoardWireCard) => TaskBoardWireCard
): void {
  const held = holdsByHost.get(hostId)?.get(refKey)
  if (held) {
    change(hostId, (next) => next.set(refKey, { ...held, card: update(held.card) }))
  }
}

function startExpiredRereads(hostId: string, now: number): boolean {
  let expired = false
  change(hostId, (next) => {
    expired = startExpiredTaskBoardMoveRereads(next, now)
  })
  return expired
}

/** The host's board with held moves placed, as the desktop board places them. */
export function withTaskBoardMoveHolds(
  board: TaskBoardListResult | undefined,
  holds: Holds
): TaskBoardListResult | undefined {
  if (!board || holds.size === 0) {
    return board
  }
  const cards = placeTaskBoardCards(board.cards, holds).map(({ card, columnId }) =>
    card.columnId === columnId ? card : { ...card, columnId }
  )
  return { ...board, cards }
}

/** `reread` must resolve once a fresh list has reached the board (or was dropped). */
export function useTaskBoardMoveHolds(hostId: string, reread: () => Promise<void>): Holds {
  const read = useCallback(() => holdsByHost.get(hostId) ?? NO_HOLDS, [hostId])
  const holds = useSyncExternalStore(subscribe, read)
  useEffect(() => {
    const expiry = nextTaskBoardMoveExpiry(holds)
    if (expiry === null) {
      return
    }
    // Dropping an expired hold alone would snap a lagging list's card back; a fresh list replaces it.
    const timer = setTimeout(
      () => {
        if (startExpiredRereads(hostId, Date.now())) {
          void reread().finally(() => change(hostId, finishTaskBoardMoveRereads))
        }
      },
      Math.max(0, expiry - Date.now())
    )
    return () => clearTimeout(timer)
  }, [holds, hostId, reread])
  return holds
}
