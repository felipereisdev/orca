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
import type { StopMutation } from '../runtime/rpc/methods/orchestration/worker/stop/single-worker-stop'
import { helperMutation } from '../runtime/rpc/methods/orchestration/worker/worker-stop'
import {
  probeOrchestrator,
  stopTaskStartWatcher,
  type TaskStartLifecycleDeps
} from './task-start-lifecycle'

export type TaskStartStopDeps = {
  lifecycle: TaskStartLifecycleDeps
  closeOrchestrator(ref: TaskStartOrchestratorRef): Promise<void>
  orchestration: {
    /** Refuses the coordinator's later worker starts in this process. */
    fence(coordinator: OrchestrationCoordinatorKey): void
    /** Unsettled workers the coordinator created, in any of its Runs. */
    liveWorkers(coordinator: OrchestrationCoordinatorKey): string[]
    stopWorker(dispatchId: string, mutation: StopMutation): Promise<WorkerStopReceipt>
  }
}

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

function proven(receipt: WorkerStopReceipt): boolean {
  return (
    !receipt.helperStopError &&
    (receipt.state === 'stopped' || receipt.alreadySettled) &&
    (receipt.helpers ?? []).every((helper) => PROVEN_HELPER.has(helper.outcome))
  )
}

/** Stops the listed workers not stopped yet; false when listing fails or any end is unproven. */
async function stopLiveWorkers(
  coordinator: OrchestrationCoordinatorKey,
  attempted: Set<string>,
  deps: TaskStartStopDeps,
  mutation: StopMutation
): Promise<boolean> {
  let live: string[]
  try {
    live = deps.orchestration.liveWorkers(coordinator)
  } catch (error) {
    console.warn('[task-start] listing the orchestrator workers failed', error)
    return false
  }
  // A worker still live after its own stop was unproven, and is reported as such below.
  const fresh = live.filter((dispatchId) => !attempted.has(dispatchId))
  fresh.forEach((dispatchId) => attempted.add(dispatchId))
  const receipts = await mapSettledWithConcurrency(fresh, STOP_CONCURRENCY, (dispatchId) =>
    deps.orchestration.stopWorker(dispatchId, helperMutation(mutation, dispatchId))
  )
  return (
    fresh.length === live.length &&
    receipts.every((receipt) => receipt.status === 'fulfilled' && proven(receipt.value))
  )
}

/** Fences and closes the orchestrator, then stops every worker it created; true only when all
 *  ends are proven. */
async function stopOrchestration(
  run: TaskStartRun,
  ref: TaskStartOrchestratorRef,
  deps: TaskStartStopDeps,
  mutation: StopMutation
): Promise<boolean> {
  const coordinator = coordinatorKey(ref)
  // Fenced before closing: a worker start already past its checks cannot insert after the listing.
  deps.orchestration.fence(coordinator)
  await deps.closeOrchestrator(ref).catch((error: unknown) => {
    console.warn('[task-start] closing the orchestrator failed', error)
  })
  const attempted = new Set<string>()
  const first = await stopLiveWorkers(coordinator, attempted, deps, mutation)
  const gone = (await probeOrchestrator(ref, deps.lifecycle, run.startedAt)) === 'gone'
  // Once more after the probe: a start inserted before the fence may have listed late.
  const second = await stopLiveWorkers(coordinator, attempted, deps, mutation)
  return first && gone && second
}

function previewAgents(run: TaskStartRun, deps: TaskStartStopDeps): number {
  if (!run.orchestrator) {
    return 1
  }
  try {
    return 1 + deps.orchestration.liveWorkers(coordinatorKey(run.orchestrator)).length
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
