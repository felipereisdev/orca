import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TaskBoardListResult } from '../../../../src/shared/task-board/task-board-wire-types'
import { defineHostQuery, readHostQueryLive, useHostQuery } from '../../query/host-query'
import { isHostNotConnectedError } from '../../query/host-query-errors'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { assertTaskBoardSupported, TaskBoardUnsupportedError } from './task-board-capability'
import { readTaskBoardList } from './task-board-operations'
import { useTaskBoardMoveHolds, withTaskBoardMoveHolds } from './task-board-move-holds'
import {
  NO_TASK_BOARD_INPUT,
  TASK_BOARD_TARGET,
  taskBoardCardsKey,
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
    // Provider changes are not signalled; coming back to the app reads them again.
    refetchOnWindowFocus: true,
    // A run's phase or state changed; the host's cached list carries it, so the read stays cheap.
    signal: { events: ['taskBoardRunsChanged'] }
  }
)

export type TaskBoardView = {
  // The host's board (this launch's read, else the one an earlier launch stored), with held moves placed.
  data: TaskBoardListResult | undefined
  // Moves and comments need the host; the board shown may be an earlier read.
  isOffline: boolean
  isRefreshing: boolean
  // When the shown board was read from the host, which may be an earlier launch's; null without one.
  readAt: number | null
  // The host has no taskBoard.* methods: "Update Orca on the host".
  unsupported: boolean
  // A read that failed while the host was reachable; offline and unsupported are reported above.
  error: Error | null
  refresh: () => Promise<void>
  // Lists again through the host's caches: after a confirmed move, whose hold covers a lagging list.
  relist: () => void
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
  const relist = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: taskBoardCardsKey(hostId), exact: true })
  }, [hostId, queryClient])
  // A confirmed move stays in its column while lists lag the provider, as on the desktop board.
  const holds = useTaskBoardMoveHolds(hostId, refresh)
  const data = useMemo(() => withTaskBoardMoveHolds(board.data, holds), [board.data, holds])
  const unsupported = board.error instanceof TaskBoardUnsupportedError
  return {
    data,
    isOffline: client === null || state !== 'connected',
    isRefreshing: board.isFetching,
    readAt: board.data ? board.dataUpdatedAt : null,
    unsupported,
    error: unsupported || isHostNotConnectedError(board.error) ? null : board.error,
    refresh,
    relist
  }
}
