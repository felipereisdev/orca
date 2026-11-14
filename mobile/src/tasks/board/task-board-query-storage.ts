import type { TaskBoardCardSource } from '../../../../src/shared/task-board/task-board-card'
import type { TaskBoardListResult } from '../../../../src/shared/task-board/task-board-wire-types'
import { hostQueryKey, type HostQueryTarget } from '../../query/host-query-key'
import {
  persistedHostQueryKey,
  type PersistedHostFamily,
  type PersistedHostQueryKey
} from '../../query/host-query-persistence'
import { taskBoardListSchema } from './task-board-reply-schema'

// Kept apart from the board's reads so the route's first-paint keys don't pull them into boot.

// The board is the paired host's own, whatever repos it relays to.
export const TASK_BOARD_TARGET: HostQueryTarget = { exec: 'local' }
export const NO_TASK_BOARD_INPUT = {}

// Card text the board never draws; Jira and Linear descriptions would push a large board past the store's value cap.
function withoutDescription(source: TaskBoardCardSource): TaskBoardCardSource {
  switch (source.provider) {
    case 'jira': {
      const { description: _description, ...item } = source.item
      return { provider: 'jira', item }
    }
    case 'linear': {
      const { description: _description, descriptionImageUrls: _images, ...item } = source.item
      return { provider: 'linear', item }
    }
    default:
      return source
  }
}

export const taskBoardCardsStorage: PersistedHostFamily<TaskBoardListResult> = {
  family: 'taskBoard.cards',
  persist: {
    version: 1,
    // The reply's own schema: a stored board is read as strictly as a live one.
    dataSchema: taskBoardListSchema,
    strip: (board) => ({
      ...board,
      cards: board.cards.map((card) => ({
        ...card,
        source: withoutDescription(card.source)
      }))
    })
  }
}

export function taskBoardCardsKey(hostId: string) {
  return hostQueryKey(hostId, taskBoardCardsStorage.family, TASK_BOARD_TARGET, NO_TASK_BOARD_INPUT)
}

/** What the board route draws before its first read: the board it showed last. */
export function firstPaintTaskBoardKeys(hostId: string): PersistedHostQueryKey[] {
  const key = persistedHostQueryKey(taskBoardCardsStorage, taskBoardCardsKey(hostId))
  return key ? [key] : []
}
