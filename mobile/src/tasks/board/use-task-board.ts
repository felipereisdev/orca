import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TaskBoardListResult } from '../../../../src/shared/task-board/task-board-wire-types'
import { defineHostQuery, readHostQueryLive, useHostQuery } from '../../query/host-query'
import { isHostNotConnectedError } from '../../query/host-query-errors'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { assertTaskBoardSupported, TaskBoardUnsupportedError } from './task-board-capability'
import { readTaskBoardList } from './task-board-operations'
import {
  NO_TASK_BOARD_INPUT,
  TASK_BOARD_TARGET,
  taskBoardCardsStorage
} from './task-board-query-storage'

export const taskBoardCardsQuery = defineHostQuery<typeof NO_TASK_BOARD_INPUT, TaskBoardListResult>(
  {
    ...taskBoardCardsStorage,
    // Only an action's read (Refresh) asks the host to skip its provider caches.
    fetch: async (client, _target, _input, _previous, read) => {
      await assertTaskBoardSupported(client)
      return readTaskBoardList(client, read.live)
    },
    gcTime: 30 * 60_000,
    // The host signals no board changes; coming back to the app reads it again.
    refetchOnWindowFocus: true
  }
)

export type TaskBoardView = {
  // The host's board: this launch's read, else the one an earlier launch stored.
  data: TaskBoardListResult | undefined
  // Moves and comments need the host; the board shown may be an earlier read.
  isOffline: boolean
  isRefreshing: boolean
  // The host has no taskBoard.* methods: "Update Orca on the host".
  unsupported: boolean
  // A read that failed while the host was reachable; offline and unsupported are reported above.
  error: Error | null
  refresh: () => Promise<void>
}

export function useTaskBoard(hostId: string): TaskBoardView {
  const queryClient = useQueryClient()
  const { client, state } = useHostClient(hostId)
  const board = useHostQuery(
    taskBoardCardsQuery,
    { hostId, client },
    TASK_BOARD_TARGET,
    NO_TASK_BOARD_INPUT
  )
  const refresh = useCallback(async (): Promise<void> => {
    if (!client || client.getState() !== 'connected') {
      return
    }
    // The failure lands on the query, which the screen reads; the caller has nothing more to do with it.
    await readHostQueryLive(
      queryClient,
      taskBoardCardsQuery,
      { hostId, client },
      TASK_BOARD_TARGET,
      NO_TASK_BOARD_INPUT,
      { replace: true }
    ).catch(() => undefined)
  }, [client, hostId, queryClient])
  const unsupported = board.error instanceof TaskBoardUnsupportedError
  return {
    data: board.data,
    isOffline: client === null || state !== 'connected',
    isRefreshing: board.isFetching,
    unsupported,
    error: unsupported || isHostNotConnectedError(board.error) ? null : board.error,
    refresh
  }
}
