import { parseExecutionHostId } from '../../shared/execution-host/execution-host'
import { isOrcaSessionId } from '../../shared/agent-session/identity/orca-session-address'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  lineageLiveSession,
  readAgentSessionRecordStore
} from '../runtime/orchestration/addressing/session-lineage/structured-session-lineage'
import { observeChatAssignee } from '../runtime/orchestration/workers/lifecycle/chat-assignee'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import { cleanUpEvictedTaskStartRuns } from './task-start-image-cleanup'
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
  | 'getTerminalPtyIdForHandle'
  | 'getTerminalPaneBinding'
  | 'getPtyLivenessVerdict'
  | 'checkTerminalAgentPresence'
  | 'subscribeToPtyExit'
  | 'subscribeTerminalSideEffects'
  | 'subscribeStructuredSessionTabHidden'
  | 'getExistingOrchestrationDb'
  | 'listRepos'
>

/** Persistence and change-event wiring for the task-start run store. */
export function createTaskStartRunStoreDeps(
  runtime: Pick<
    TaskStartLifecycleRuntime,
    'getUIState' | 'updateUIState' | 'notifyTaskBoardRunsChanged' | 'listRepos'
  >
): TaskStartRunStoreDeps {
  return {
    // Already normalized at load; re-normalizing here would fail runs still pending in this process.
    read: () => runtime.getUIState().taskStartRuns ?? {},
    write: (next) => {
      runtime.updateUIState({ taskStartRuns: next })
    },
    now: () => new Date(),
    emit: (event) => runtime.notifyTaskBoardRunsChanged(event),
    evicted: cleanUpEvictedTaskStartRuns(() => runtime.listRepos())
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
      ptyIdForHandle: (handle) => runtime.getTerminalPtyIdForHandle(handle),
      paneBinding: (paneKey, worktreeId) => runtime.getTerminalPaneBinding(paneKey, worktreeId),
      ptyLiveness: (ptyId) => runtime.getPtyLivenessVerdict(ptyId),
      agentPresence: (handle, exitedSince) =>
        runtime.checkTerminalAgentPresence(handle, exitedSince),
      subscribeExit: (ptyId, listener) => runtime.subscribeToPtyExit(ptyId, listener),
      subscribeAgentExited: (ptyId, listener) =>
        runtime.subscribeTerminalSideEffects((batch) => {
          if (
            batch.ptyId === ptyId &&
            !batch.replay &&
            batch.facts.some((fact) => fact.kind === 'agent-exited')
          ) {
            listener()
          }
        })
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
      liveSessionId: (sessionId) => {
        const store = readAgentSessionRecordStore()
        return store ? (lineageLiveSession(store, sessionId)?.sessionId ?? null) : null
      },
      subscribeTabHidden: (listener) => runtime.subscribeStructuredSessionTabHidden(listener),
      subscribeStatus: (listener) =>
        getStructuredAgentSessionHost()?.subscribeStatus({
          id: `task-start-watch:${crypto.randomUUID()}`,
          emit: listener
        }) ?? null
    }
  }
}
