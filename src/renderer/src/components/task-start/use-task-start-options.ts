import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { getTaskStartOptions } from '@/runtime/task-board/runtime-task-board-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type {
  TaskBoardCardRef,
  TaskStartOptionsResult
} from '../../../../shared/task-board/task-board-wire-types'

type TaskStartOptionsState = { data?: TaskStartOptionsResult; loading: boolean; error?: string }

/** Start options of the board host `hostId` (the Tasks page's `accountBackedTaskSourceHostId`). */
export function useTaskStartOptions(
  params: { ref?: TaskBoardCardRef; repoId?: string },
  hostId: ExecutionHostId
): TaskStartOptionsState {
  const key = JSON.stringify([hostId, params.ref ?? null, params.repoId ?? null])
  const [state, setState] = useState<{ key: string } & TaskStartOptionsState>({
    key,
    loading: true
  })
  useEffect(() => {
    const controller = new AbortController()
    const target = ipcOrRuntimeTargetForHostId(hostId)
    if (!target) {
      setState({
        key,
        loading: false,
        error: translate('taskBoard.hostUnavailable', 'This host is not available.')
      })
      return
    }
    setState({ key, loading: true })
    getTaskStartOptions(target, params, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ key, loading: false, data })
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            loading: false,
            error:
              cause instanceof Error && cause.message
                ? cause.message
                : translate('taskStart.optionsLoadFailed', 'Could not load agent options.')
          })
        }
      })
    return () => controller.abort()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- key covers hostId and params by value.
  }, [key])
  // A stale result for another key is never shown as current.
  return state.key === key
    ? { loading: state.loading, data: state.data, error: state.error }
    : { loading: true }
}
