import { TASK_BOARD_CACHE_TTL_MS, TaskBoardHostCache } from './task-board-host-cache'

const MAX_HOLDS = 500

/** Confirmed moves the provider lists may lag, held for as long as those lists cache. */
export type TaskBoardMoveHolds = {
  hold(refKey: string, from: string, to: string): void
  /** The column a listed card shows: `to` while its list still says `from`; any other column ends the hold. */
  place(refKey: string, listedColumnId: string): string
}

export function createTaskBoardMoveHolds(now?: () => number): TaskBoardMoveHolds {
  const holds = new TaskBoardHostCache<{ from: string; to: string }>(
    TASK_BOARD_CACHE_TTL_MS,
    MAX_HOLDS,
    now
  )
  return {
    hold: (refKey, from, to) => holds.set(refKey, { from, to }),
    place: (refKey, listedColumnId) => {
      const held = holds.get(refKey)
      if (!held) {
        return listedColumnId
      }
      if (listedColumnId === held.from) {
        return held.to
      }
      holds.delete(refKey)
      return listedColumnId
    }
  }
}
