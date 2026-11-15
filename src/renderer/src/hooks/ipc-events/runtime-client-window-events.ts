import { emitAutomationsChangedWindowEvent } from '@/components/automations/events/automations-changed-window-event'
import { handleTaskBoardRunsChanged } from '@/runtime/task-board/task-board-runs-changed'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import type { RuntimeClientEvent } from '../../../../shared/runtime-client-events'

/** A paired host's change that pages read from window events; true when `event` was one. */
export function dispatchRuntimeClientWindowEvent(
  environmentId: string,
  event: RuntimeClientEvent
): boolean {
  if (event.type === 'automationsChanged') {
    // Why: without the environment the subscriber cannot attribute the changed authority.
    emitAutomationsChangedWindowEvent({
      environmentId,
      ...(event.selector ? { selector: event.selector } : {}),
      ...(event.reason ? { reason: event.reason } : {})
    })
    return true
  }
  if (event.type === 'taskBoardRunsChanged') {
    handleTaskBoardRunsChanged(toRuntimeExecutionHostId(environmentId), event)
    return true
  }
  return false
}
