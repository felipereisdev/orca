import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import {
  TASK_BOARD_MOVE_OVERRIDE_TTL_MS,
  type TaskBoardMoveOverride
} from '@/lib/work-items/task-board/task-board-move-overrides'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

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
  card: TaskBoardCard,
  columnId: string
): void {
  change(host, (next) => next.set(card.refKey, { card, columnId }))
}

export function confirmTaskBoardMove(
  host: ExecutionHostId,
  card: TaskBoardCard,
  columnId: string
): void {
  const expiresAt = Date.now() + TASK_BOARD_MOVE_OVERRIDE_TTL_MS
  change(host, (next) => next.set(card.refKey, { card, columnId, expiresAt }))
}

/** Rolls the card back to wherever its provider reads place it. */
export function releaseTaskBoardMove(host: ExecutionHostId, refKey: string): void {
  change(host, (next) => next.delete(refKey))
}

/** Marks expired holds as re-reading and returns the providers to read again. */
function startExpiredRereads(host: ExecutionHostId, now: number): Set<TaskProvider> {
  const providers = new Set<TaskProvider>()
  change(host, (next) => {
    for (const [refKey, override] of next) {
      if (override.expiresAt !== undefined && !override.rereading && override.expiresAt <= now) {
        next.set(refKey, { ...override, rereading: true })
        providers.add(override.card.provider)
      }
    }
  })
  return providers
}

/** The fresh read is now authoritative; a hold re-made meanwhile (no `rereading`) stays. */
function finishRereads(host: ExecutionHostId, provider: TaskProvider): void {
  change(host, (next) => {
    for (const [refKey, override] of next) {
      if (override.rereading && override.card.provider === provider) {
        next.delete(refKey)
      }
    }
  })
}

/** `reread` must resolve once a fresh read of the provider has reached the board (or was dropped). */
export function useTaskBoardMoveOverrides(
  host: ExecutionHostId,
  reread: (provider: TaskProvider) => Promise<void>
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
    const expiries = [...current.values()].flatMap((override) =>
      override.expiresAt === undefined || override.rereading ? [] : [override.expiresAt]
    )
    if (expiries.length === 0) {
      return
    }
    // Why: a read that lagged the move left the old card in the board's state; dropping the hold
    // alone would snap it back, so the hold stays until a fresh read replaces it.
    const timer = setTimeout(
      () => {
        for (const provider of startExpiredRereads(host, Date.now())) {
          void reread(provider).finally(() => finishRereads(host, provider))
        }
      },
      Math.max(0, Math.min(...expiries) - Date.now())
    )
    return () => clearTimeout(timer)
  }, [current, host, reread])
  return { overrides: current, updatingRefKeys }
}
