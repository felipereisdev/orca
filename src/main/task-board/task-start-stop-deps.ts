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
import type { StopMutation } from '../runtime/rpc/methods/orchestration/worker/stop/single-worker-stop'
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

/** This host's orchestration database behind ⏹; no database means no Runs and no workers. */
export function createTaskStartStopDeps(runtime: OrcaRuntimeService): TaskStartStopDeps {
  const db = () => runtime.getExistingOrchestrationDb()
  return {
    lifecycle: createTaskStartLifecycleDeps(runtime),
    closeOrchestrator: (ref) => closeTaskStartOrchestrator(runtime, ref),
    orchestration: {
      boundRunIds: (key) =>
        db()
          ?.runsBoundToCoordinator(key)
          .map((run) => run.id) ?? [],
      workers: (runId) => db()?.listWorkerTerminalResources({ runId }) ?? [],
      stopWorker: (dispatchId, mutation) => stopWorkerAndHelpers(runtime, dispatchId, mutation)
    }
  }
}

/** A worker on a paired server is stopped under a request id it can replay; a fresh one per ⏹,
 *  as each `orca orchestration worker-stop` mints. */
export function taskStartStopMutation(): StopMutation {
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
