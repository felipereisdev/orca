import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import {
  TASK_BOARD_MOVE_OVERRIDE_TTL_MS,
  type TaskBoardMoveOverride
} from '@/lib/work-items/task-board/task-board-move-overrides'

// Why: module scope, so a move settling after the board unmounted (a card detail opened) still holds its card.
let overrides: ReadonlyMap<string, TaskBoardMoveOverride> = new Map()
const listeners = new Set<() => void>()

function change(update: (next: Map<string, TaskBoardMoveOverride>) => void): void {
  const next = new Map(overrides)
  update(next)
  overrides = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readOverrides(): ReadonlyMap<string, TaskBoardMoveOverride> {
  return overrides
}

/** Synchronous, so a second drop of the same card is refused before the board re-renders. */
export function isTaskBoardMoveInFlight(refKey: string): boolean {
  const override = overrides.get(refKey)
  return override !== undefined && override.expiresAt === undefined
}

export function holdTaskBoardMove(card: TaskBoardCard, columnId: string): void {
  change((next) => next.set(card.refKey, { card, columnId }))
}

export function confirmTaskBoardMove(card: TaskBoardCard, columnId: string): void {
  const expiresAt = Date.now() + TASK_BOARD_MOVE_OVERRIDE_TTL_MS
  change((next) => next.set(card.refKey, { card, columnId, expiresAt }))
}

/** Rolls the card back to wherever its provider reads place it. */
export function releaseTaskBoardMove(refKey: string): void {
  change((next) => next.delete(refKey))
}

function expireTaskBoardMoves(now: number): void {
  change((next) => {
    for (const [refKey, override] of next) {
      if (override.expiresAt !== undefined && override.expiresAt <= now) {
        next.delete(refKey)
      }
    }
  })
}

export function useTaskBoardMoveOverrides(): {
  overrides: ReadonlyMap<string, TaskBoardMoveOverride>
  updatingRefKeys: ReadonlySet<string>
} {
  const current = useSyncExternalStore(subscribe, readOverrides)
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
    const expiries = [...current.values()].flatMap((override) =>
      override.expiresAt === undefined ? [] : [override.expiresAt]
    )
    if (expiries.length === 0) {
      return
    }
    const timer = setTimeout(
      () => expireTaskBoardMoves(Date.now()),
      Math.max(0, Math.min(...expiries) - Date.now())
    )
    return () => clearTimeout(timer)
  }, [current])
  return { overrides: current, updatingRefKeys }
}
