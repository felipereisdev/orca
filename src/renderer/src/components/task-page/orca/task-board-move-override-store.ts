import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { TaskBoardWireCard } from '../../../../../shared/task-board/task-board-wire-types'
import {
  finishTaskBoardMoveRereads,
  nextTaskBoardMoveExpiry,
  startExpiredTaskBoardMoveRereads,
  TASK_BOARD_MOVE_OVERRIDE_TTL_MS,
  type TaskBoardMoveOverride
} from '../../../../../shared/task-board/task-board-move-overrides'
import type { ExecutionHostId } from '../../../../../shared/execution-host/execution-host'

type Overrides = ReadonlyMap<string, TaskBoardMoveOverride>

// Why: module scope, so a move settling after the board unmounted (a card detail opened) still holds its card.
const overridesByHost = new Map<ExecutionHostId, Overrides>()
const NO_OVERRIDES: Overrides = new Map()
const listeners = new Set<() => void>()

function change(
  host: ExecutionHostId,
  update: (next: Map<string, TaskBoardMoveOverride>) => void
): void {
  const next = new Map(overridesByHost.get(host))
  update(next)
  overridesByHost.set(host, next)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Synchronous, so a second drop of the same card is refused before the board re-renders. */
export function isTaskBoardMoveInFlight(host: ExecutionHostId, refKey: string): boolean {
  const override = overridesByHost.get(host)?.get(refKey)
  return override !== undefined && override.expiresAt === undefined
}

export function holdTaskBoardMove(
  host: ExecutionHostId,
  card: TaskBoardWireCard,
  columnId: string
): void {
  change(host, (next) => next.set(card.refKey, { card, columnId }))
}

export function confirmTaskBoardMove(
  host: ExecutionHostId,
  card: TaskBoardWireCard,
  columnId: string
): void {
  const expiresAt = Date.now() + TASK_BOARD_MOVE_OVERRIDE_TTL_MS
  change(host, (next) => next.set(card.refKey, { card, columnId, expiresAt }))
}

/** A held card shows the held copy, so a change made after the move must reach it too. */
export function changeHeldTaskBoardCard(
  host: ExecutionHostId,
  refKey: string,
  update: (card: TaskBoardWireCard) => TaskBoardWireCard
): void {
  const held = overridesByHost.get(host)?.get(refKey)
  if (held) {
    change(host, (next) => next.set(refKey, { ...held, card: update(held.card) }))
  }
}

/** Rolls the card back to wherever the host's list places it. */
export function releaseTaskBoardMove(host: ExecutionHostId, refKey: string): void {
  change(host, (next) => next.delete(refKey))
}

/** Marks expired holds as re-reading; true when any did expire. */
function startExpiredRereads(host: ExecutionHostId, now: number): boolean {
  let expired = false
  change(host, (next) => {
    expired = startExpiredTaskBoardMoveRereads(next, now)
  })
  return expired
}

function finishRereads(host: ExecutionHostId): void {
  change(host, finishTaskBoardMoveRereads)
}

/** `reread` must resolve once a fresh list has reached the board (or was dropped). */
export function useTaskBoardMoveOverrides(
  host: ExecutionHostId,
  reread: () => Promise<void>
): {
  overrides: Overrides
  updatingRefKeys: ReadonlySet<string>
} {
  const read = useCallback(() => overridesByHost.get(host) ?? NO_OVERRIDES, [host])
  const current = useSyncExternalStore(subscribe, read)
  const updatingRefKeys = useMemo(
    () =>
      new Set(
        [...current.values()]
          .filter((override) => override.expiresAt === undefined)
          .map((override) => override.card.refKey)
      ),
    [current]
  )
  useEffect(() => {
    const expiry = nextTaskBoardMoveExpiry(current)
    if (expiry === null) {
      return
    }
    // Why: a list that lagged the move left the old card in the board's state; dropping the hold
    // alone would snap it back, so the hold stays until a fresh list replaces it.
    const timer = setTimeout(
      () => {
        if (startExpiredRereads(host, Date.now())) {
          void reread().finally(() => finishRereads(host))
        }
      },
      Math.max(0, expiry - Date.now())
    )
    return () => clearTimeout(timer)
  }, [current, host, reread])
  return { overrides: current, updatingRefKeys }
}
