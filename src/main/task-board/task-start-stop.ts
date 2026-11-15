import { mapSettledWithConcurrency } from '../../shared/map-with-concurrency'
import { isOrcaSessionId } from '../../shared/orca-session-address'
import type {
  HelperStopOutcome,
  WorkerStopReceipt
} from '../../shared/orchestration/workers/orchestration-worker-stop-receipt'
import type { TaskStopResult } from '../../shared/task-board/task-board-wire-types'
import {
  isTaskStartRunExclusive,
  summarizeTaskStartRun,
  type TaskStartOrchestratorRef,
  type TaskStartRun
} from '../../shared/task-board/task-start-run'
import type { OrchestrationCoordinatorKey } from '../runtime/orchestration/addressing/orchestration-caller-identity'
import { WORKER_SETTLED_STATES } from '../runtime/orchestration/terminal-authority/release/worker-terminal-ownership'
import type { StopMutation } from '../runtime/rpc/methods/orchestration/worker/stop/single-worker-stop'
import {
  probeOrchestrator,
  stopTaskStartWatcher,
  type TaskStartLifecycleDeps
} from './task-start-lifecycle'

export type TaskStartWorker = { dispatchId: string; workerState: string }

export type TaskStartStopDeps = {
  lifecycle: TaskStartLifecycleDeps
  closeOrchestrator(ref: TaskStartOrchestratorRef): Promise<void>
  orchestration: {
    /** Every Run the orchestrator coordinates, not only its current one. */
    boundRunIds(key: OrchestrationCoordinatorKey): string[]
    workers(runId: string): TaskStartWorker[]
    stopWorker(dispatchId: string, mutation: StopMutation): Promise<WorkerStopReceipt>
  }
}

const SETTLED: ReadonlySet<string> = new Set(WORKER_SETTLED_STATES)
// A helper the user kept open is a decision, not an unproven stop.
const PROVEN_HELPER: ReadonlySet<HelperStopOutcome['outcome']> = new Set([
  'stopped',
  'already_finished',
  'kept_open'
])
const STOP_CONCURRENCY = 8

function coordinatorKey(ref: TaskStartOrchestratorRef): OrchestrationCoordinatorKey {
  if (ref.surface === 'chat') {
    return {
      terminalHandle: null,
      paneKey: null,
      orcaSessionId: ref.sessionId && isOrcaSessionId(ref.sessionId) ? ref.sessionId : null
    }
  }
  return { terminalHandle: ref.handle ?? null, paneKey: ref.paneKey ?? null, orcaSessionId: null }
}

function liveWorkers(runIds: string[], deps: TaskStartStopDeps): string[] {
  const ids = runIds.flatMap((runId) =>
    deps.orchestration
      .workers(runId)
      .filter((worker) => worker.workerState !== 'unsupervised' && !SETTLED.has(worker.workerState))
      .map((worker) => worker.dispatchId)
  )
  return [...new Set(ids)]
}

function proven(receipt: WorkerStopReceipt): boolean {
  return (
    !receipt.helperStopError &&
    (receipt.state === 'stopped' || receipt.alreadySettled) &&
    (receipt.helpers ?? []).every((helper) => PROVEN_HELPER.has(helper.outcome))
  )
}

function workerMutation(mutation: StopMutation, dispatchId: string): StopMutation {
  return mutation && { ...mutation, requestId: `${mutation.requestId}:${dispatchId}` }
}

/** Closes the orchestrator, then stops every worker of its Runs; true only when all ends are proven. */
async function stopOrchestration(
  run: TaskStartRun,
  ref: TaskStartOrchestratorRef,
  deps: TaskStartStopDeps,
  mutation: StopMutation
): Promise<boolean> {
  let runIds: string[]
  try {
    // Read before closing: the orchestrator's Runs stay its own, but read them while it is known.
    runIds = deps.orchestration.boundRunIds(coordinatorKey(ref))
  } catch (error) {
    console.warn('[task-start] listing the orchestrator Runs failed', error)
    runIds = []
  }
  // Closed first, so it cannot start a worker while its workers are stopped.
  await deps.closeOrchestrator(ref).catch((error: unknown) => {
    console.warn('[task-start] closing the orchestrator failed', error)
  })
  let workers: string[]
  try {
    workers = liveWorkers(runIds, deps)
  } catch (error) {
    console.warn('[task-start] listing the orchestrator workers failed', error)
    return false
  }
  const receipts = await mapSettledWithConcurrency(workers, STOP_CONCURRENCY, (dispatchId) =>
    deps.orchestration.stopWorker(dispatchId, workerMutation(mutation, dispatchId))
  )
  const allProven = receipts.every((r) => r.status === 'fulfilled' && proven(r.value))
  const gone = (await probeOrchestrator(ref, deps.lifecycle, run.startedAt)) === 'gone'
  return allProven && gone
}

function previewAgents(run: TaskStartRun, deps: TaskStartStopDeps): number {
  if (!run.orchestrator) {
    return 1
  }
  try {
    return (
      1 + liveWorkers(deps.orchestration.boundRunIds(coordinatorKey(run.orchestrator)), deps).length
    )
  } catch {
    return 1
  }
}

/** ⏹: ends the card's orchestrator and its workers; never the worktree, branch or commits.
 *  An unproven end leaves the run `stopping` (`stop-unconfirmed`), and a repeat retries it. */
export async function stopTaskStartRun(
  cardKey: string,
  deps: TaskStartStopDeps,
  mutation: StopMutation,
  options: { preview?: boolean } = {}
): Promise<TaskStopResult> {
  const { store } = deps.lifecycle
  const run = store.get(cardKey)
  if (!run || !isTaskStartRunExclusive(run)) {
    return {
      ok: true,
      run: run ? summarizeTaskStartRun(run) : null,
      ...(options.preview ? { agents: 0 } : {})
    }
  }
  if (options.preview) {
    return { ok: true, run: summarizeTaskStartRun(run), agents: previewAgents(run, deps) }
  }
  // Stopping blocks a new start before anything is closed.
  const stopping = store.transition(run.id, ['running', 'waiting', 'stopping'], {
    state: 'stopping'
  })
  if (!stopping || store.inFlight.has(run.id)) {
    // A start alive here sees `stopping` after its next step, closes what it opened and settles.
    const current = stopping ?? store.getById(run.id)
    return { ok: true, run: current ? summarizeTaskStartRun(current) : null }
  }
  stopTaskStartWatcher(store, run.id)
  const ref = stopping.orchestrator
  // Without a ref, a start that died in this process published nothing to close.
  const ended = ref ? await stopOrchestration(stopping, ref, deps, mutation) : true
  const settled = ended
    ? store.transition(run.id, ['stopping'], {
        state: 'stopped',
        failure: ref ? undefined : 'cancelled'
      })
    : store.transition(run.id, ['stopping'], { failure: 'stop-unconfirmed' })
  const current = settled ?? store.getById(run.id)
  return { ok: true, run: current ? summarizeTaskStartRun(current) : null }
}
