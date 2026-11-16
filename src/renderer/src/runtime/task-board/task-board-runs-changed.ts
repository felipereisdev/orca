import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { TaskBoardRunsChangedEvent } from '../../../../shared/remote-runtime/session-graph/runtime-client-events'
import {
  notifyTaskStartWaiting,
  type TaskStartWaitingItem
} from './task-start-waiting-notification'

const TASK_BOARD_RUNS_CHANGED_EVENT = 'orca:task-board-runs-changed'

type TaskBoardRunsChangedDetail = { hostId: ExecutionHostId }

function isWaitingItem(value: unknown): value is TaskStartWaitingItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cardKey' in value &&
    typeof value.cardKey === 'string' &&
    'worktreeId' in value &&
    typeof value.worktreeId === 'string' &&
    'title' in value &&
    typeof value.title === 'string'
  )
}

/** `hostId`'s task-start runs changed: its boards re-list, and each run that began waiting notifies once. */
export function handleTaskBoardRunsChanged(
  hostId: ExecutionHostId,
  event: TaskBoardRunsChangedEvent
): void {
  window.dispatchEvent(
    new CustomEvent<TaskBoardRunsChangedDetail>(TASK_BOARD_RUNS_CHANGED_EVENT, {
      detail: { hostId }
    })
  )
  // The host lists a run here only on its entry into waiting, so each item is one transition.
  const waiting: unknown[] = Array.isArray(event.waiting) ? event.waiting : []
  for (const item of waiting) {
    if (isWaitingItem(item)) {
      notifyTaskStartWaiting(hostId, item)
    }
  }
}

export function subscribeTaskBoardRunsChanged(
  hostId: ExecutionHostId,
  listener: () => void
): () => void {
  const onEvent = (event: Event): void => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : null
    if (
      typeof detail === 'object' &&
      detail !== null &&
      'hostId' in detail &&
      detail.hostId === hostId
    ) {
      listener()
    }
  }
  window.addEventListener(TASK_BOARD_RUNS_CHANGED_EVENT, onEvent)
  return () => window.removeEventListener(TASK_BOARD_RUNS_CHANGED_EVENT, onEvent)
}
