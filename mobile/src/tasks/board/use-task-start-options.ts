import { useEffect, useState } from 'react'
import type {
  TaskBoardCardRef,
  TaskStartOptionsResult
} from '../../../../src/shared/task-board/task-board-wire-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { getTaskStartOptions } from './task-board-operations'

export type TaskStartOptionsRead = {
  data?: TaskStartOptionsResult
  loading: boolean
  error?: string
}

/** The host's "Start as…" defaults for the card, or for the repository the user picked. */
export function useTaskStartOptions(
  client: RpcClient | null,
  connected: boolean,
  ref: TaskBoardCardRef,
  repoId: string | undefined
): TaskStartOptionsRead {
  const [read, setRead] = useState<TaskStartOptionsRead>({ loading: true })
  const refKey = JSON.stringify(ref)
  useEffect(() => {
    if (!client || !connected) {
      setRead((current) => ({ ...current, loading: false }))
      return
    }
    let current = true
    setRead((previous) => ({ data: previous.data, loading: true }))
    getTaskStartOptions(client, { ref, ...(repoId ? { repoId } : {}) })
      .then((data) => {
        if (current) {
          setRead({ data, loading: false })
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setRead({
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause)
          })
        }
      })
    return () => {
      current = false
    }
    // `refKey` stands in for `ref`, which the board rebuilds on every list.
  }, [client, connected, refKey, repoId])
  return read
}
