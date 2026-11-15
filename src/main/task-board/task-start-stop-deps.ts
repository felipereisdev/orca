import type {
  TaskBoardCardRef,
  TaskStopResult
} from '../../shared/task-board/task-board-wire-types'
import type { TaskStartOrchestratorRef } from '../../shared/task-board/task-start-run'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  captureStructuredSessionSurface,
  retireCapturedStructuredSessionSurface
} from '../runtime/agent-session/structured-agent-session-close'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationCoordinatorKey } from '../runtime/orchestration/addressing/orchestration-caller-identity'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { WorkerStopReceipt } from '../../shared/orchestration/workers/orchestration-worker-stop-receipt'
import {
  getRemoteDispatch,
  isRemoteDispatchTerminal
} from '../runtime/orchestration/db/remote-owned/remote-dispatch-records'
import { getOpenRemoteRunLink } from '../runtime/orchestration/db/remote-owned/remote-run-links'
import { stopRemoteWorker } from '../runtime/orchestration/federation/remote-owned/remote-owned-stop'
import type { StopMutation } from '../runtime/rpc/methods/orchestration/worker/stop/single-worker-stop'
import { fenceCoordinator } from '../runtime/orchestration/workers/launch/coordinator-start-fence'
import { stopWorkerAndHelpers } from '../runtime/rpc/methods/orchestration/worker/worker-stop'
import { taskBoardRefKeyForRef } from './task-board-host-card'
import { createTaskBoardServiceDeps } from './task-board-host-deps'
import { createTaskStartLifecycleDeps } from './task-start-lifecycle-deps'
import { stopTaskStartRun, type TaskStartStopDeps } from './task-start-stop'

/** Closes an orchestrator the way its tab's close does: terminal, or chat surface then session. */
export async function closeTaskStartOrchestrator(
  runtime: OrcaRuntimeService,
  ref: TaskStartOrchestratorRef
): Promise<void> {
  if (ref.surface === 'terminal') {
    if (ref.handle) {
      await runtime.closeTerminal(ref.handle)
    }
    return
  }
  const host = getStructuredAgentSessionHost()
  if (!host || !ref.sessionId) {
    return
  }
  const surface = captureStructuredSessionSurface(host, ref.sessionId, runtime)
  try {
    await retireCapturedStructuredSessionSurface(host, ref.sessionId, surface, runtime)
  } finally {
    await host.close(ref.sessionId, 'user-close')
  }
}

/** Every unsettled worker the coordinator started: here, and on servers that own their workers. */
export function listTaskStartWorkers(
  db: OrchestrationDb,
  coordinator: OrchestrationCoordinatorKey
): string[] {
  return [
    ...db.listLiveWorkerDispatchIdsCreatedBy(coordinator),
    ...db.listLiveRemoteOwnedDispatchIdsCoordinatedBy(coordinator)
  ]
}

/** A worker a server owns is stopped through its owed-stop route, and proven only once the
 *  server's queue says it ended; any other goes through worker-stop. */
async function stopTaskStartWorker(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  mutation: StopMutation
): Promise<WorkerStopReceipt> {
  const db = runtime.getOrchestrationDb()
  const remote = getRemoteDispatch(db, dispatchId)
  if (!remote) {
    return stopWorkerAndHelpers(runtime, dispatchId, mutation)
  }
  const link = getOpenRemoteRunLink(db, remote.conversation_id)
  if (link) {
    await stopRemoteWorker(runtime, link, dispatchId, undefined).catch((error: unknown) => {
      console.warn('[task-start] stopping a server-owned worker failed', error)
    })
  }
  const record = getRemoteDispatch(db, dispatchId) ?? remote
  const ended = isRemoteDispatchTerminal(record)
  return {
    dispatchId,
    state: ended ? 'stopped' : (record.worker_state ?? 'stop_requested'),
    alreadySettled: false,
    processAction: 'none'
  }
}

/** This host's orchestration database behind ⏹; no database means no workers. */
export function createTaskStartStopDeps(runtime: OrcaRuntimeService): TaskStartStopDeps {
  const db = () => runtime.getExistingOrchestrationDb()
  return {
    lifecycle: createTaskStartLifecycleDeps(runtime),
    closeOrchestrator: (ref) => closeTaskStartOrchestrator(runtime, ref),
    orchestration: {
      fence: (coordinator) => fenceCoordinator(runtime, coordinator),
      liveWorkers: (coordinator) => {
        const current = db()
        return current ? listTaskStartWorkers(current, coordinator) : []
      },
      stopWorker: (dispatchId, mutation) => stopTaskStartWorker(runtime, dispatchId, mutation)
    }
  }
}

/** A worker on a paired server is stopped under a request id it can replay; a fresh one per ⏹,
 *  as each `orca orchestration worker-stop` mints. */
export function taskStartStopMutation(): StopMutation {
  // Only `requestId` is read on the stop path; the other fields are placeholders.
  return {
    callerFingerprint: 'task-board',
    requestId: crypto.randomUUID(),
    method: 'taskBoard.stopTask',
    payloadHash: ''
  }
}

/** ⏹ for a card on this host; a card whose repo left the host has no run here. */
export async function stopTaskFromCard(
  runtime: OrcaRuntimeService,
  ref: TaskBoardCardRef,
  preview: boolean
): Promise<TaskStopResult> {
  let cardKey: string
  try {
    cardKey = taskBoardRefKeyForRef(ref, createTaskBoardServiceDeps(runtime))
  } catch {
    return { ok: true, run: null }
  }
  return stopTaskStartRun(cardKey, createTaskStartStopDeps(runtime), taskStartStopMutation(), {
    preview
  })
}
