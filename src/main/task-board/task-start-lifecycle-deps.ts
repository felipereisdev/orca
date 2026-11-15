import { parseExecutionHostId } from '../../shared/execution-host'
import { isOrcaSessionId } from '../../shared/orca-session-address'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { observeChatAssignee } from '../runtime/orchestration/workers/lifecycle/chat-assignee'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import type { TaskStartLifecycleDeps } from './task-start-lifecycle'
import {
  createTaskStartRunStore,
  type TaskStartRunStore,
  type TaskStartRunStoreDeps
} from './task-start-run-store'

export type TaskStartLifecycleRuntime = Pick<
  OrcaRuntimeService,
  | 'getUIState'
  | 'updateUIState'
  | 'notifyTaskBoardRunsChanged'
  | 'showTerminal'
  | 'getTerminalHandleForPaneKey'
  | 'getTerminalLivenessVerdict'
  | 'waitForTerminal'
  | 'getExistingOrchestrationDb'
>

/** Persistence and change-event wiring for the task-start run store. */
export function createTaskStartRunStoreDeps(
  runtime: Pick<
    TaskStartLifecycleRuntime,
    'getUIState' | 'updateUIState' | 'notifyTaskBoardRunsChanged'
  >
): TaskStartRunStoreDeps {
  return {
    // Already normalized at load; re-normalizing here would fail runs still pending in this process.
    read: () => runtime.getUIState().taskStartRuns ?? {},
    write: (next) => {
      runtime.updateUIState({ taskStartRuns: next })
    },
    now: () => new Date(),
    emit: (event) => runtime.notifyTaskBoardRunsChanged(event)
  }
}

// One per host runtime, so `inFlight` is shared by every start and listing in this process.
const taskStartRunStores = new WeakMap<object, TaskStartRunStore>()

export function getTaskStartRunStore(runtime: TaskStartLifecycleRuntime): TaskStartRunStore {
  let store = taskStartRunStores.get(runtime)
  if (!store) {
    store = createTaskStartRunStore(createTaskStartRunStoreDeps(runtime))
    taskStartRunStores.set(runtime, store)
  }
  return store
}

function isExecutionHostReachable(hostId: string): boolean {
  const host = parseExecutionHostId(hostId)
  if (host?.kind === 'local') {
    return true
  }
  // Another runtime's terminals are not this process's to observe.
  return (
    host?.kind === 'ssh' &&
    getSshConnectionManager()?.getState(host.targetId)?.status === 'connected'
  )
}

/** Liveness reads and exit signals for task-start orchestrators on this host. */
export function createTaskStartLifecycleDeps(
  runtime: TaskStartLifecycleRuntime
): TaskStartLifecycleDeps {
  return {
    store: getTaskStartRunStore(runtime),
    hostReachable: isExecutionHostReachable,
    terminal: {
      show: (handle) => runtime.showTerminal(handle),
      handleForPaneKey: (paneKey) => runtime.getTerminalHandleForPaneKey(paneKey),
      liveness: (handle) => runtime.getTerminalLivenessVerdict(handle),
      waitForExit: async (handle, signal) => {
        const wait = await runtime.waitForTerminal(handle, { condition: 'exit', signal })
        if (wait.status !== 'exited') {
          // Not a proven exit; the next reconcile probes again.
          throw new Error('terminal_exit_unconfirmed')
        }
        return wait
      }
    },
    chat: {
      liveness: (sessionId) => {
        if (!isOrcaSessionId(sessionId)) {
          return 'unverifiable'
        }
        const observed = observeChatAssignee(sessionId, runtime.getExistingOrchestrationDb())
        return observed.status === 'live'
          ? 'alive'
          : observed.status === 'exited'
            ? 'gone'
            : 'unverifiable'
      },
      subscribeStatus: (listener) =>
        getStructuredAgentSessionHost()?.subscribeStatus({
          id: `task-start-watch:${crypto.randomUUID()}`,
          emit: listener
        }) ?? null
    }
  }
}
