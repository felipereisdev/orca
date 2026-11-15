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
import type { TaskStartRunPatch } from './task-start-run-store'

export type TaskStartStopDeps = {
  lifecycle: TaskStartLifecycleDeps
  closeOrchestrator(ref: TaskStartOrchestratorRef): Promise<void>
  orchestration: {
    /** Refuses the coordinator's later worker starts in this process. */
    fence(coordinator: OrchestrationCoordinatorKey): void
    /** Unsettled workers the coordinator created, in any of its Runs, here or on a server. */
    liveWorkers(coordinator: OrchestrationCoordinatorKey): string[]
    stopWorker(dispatchId: string, mutation: StopMutation): Promise<WorkerStopReceipt>
    /** Starts sent to a server that has not answered: nothing to stop yet, nothing proven. */
    pendingStarts(coordinator: OrchestrationCoordinatorKey): number
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
  if (ref.surface === 'chat' && ref.sessionId && isOrcaSessionId(ref.sessionId)) {
    return { terminalHandle: null, paneKey: null, orcaSessionId: ref.sessionId }
  }
  // A chat without an Orca session id still names its surface by handle and pane.
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
  // Counted before the last listing: an answer recorded after it would leave its Dispatch unlisted.
  const settled = noPendingStarts(coordinator, deps)
  // Once more after the probe: a start inserted before the fence may have listed late.
  const second = await stopLiveWorkers(coordinator, attempted, deps, mutation)
  // A key naming nobody lists no workers, which proves nothing.
  const identified = !!(
    coordinator.terminalHandle ||
    coordinator.paneKey ||
    coordinator.orcaSessionId
  )
  return identified && first && gone && second && settled
}

function noPendingStarts(
  coordinator: OrchestrationCoordinatorKey,
  deps: TaskStartStopDeps
): boolean {
  try {
    return deps.orchestration.pendingStarts(coordinator) === 0
  } catch (error) {
    console.warn('[task-start] listing the orchestrator pending starts failed', error)
    return false
  }
}

function previewAgents(run: TaskStartRun, deps: TaskStartStopDeps): number {
  if (!run.orchestrator) {
    return 1
  }
  try {
    const coordinator = coordinatorKey(run.orchestrator)
    return (
      1 +
      deps.orchestration.liveWorkers(coordinator).length +
      deps.orchestration.pendingStarts(coordinator)
    )
  } catch {
    return 1
  }
}

/** Ends what `ref` names for a run already `stopping`, then settles it: `stopped` once every
 *  end is proven, else still `stopping` (`stop-unconfirmed`) with the ref a repeat retries. */
export async function settleStoppingTaskStartRun(
  run: TaskStartRun,
  ref: TaskStartOrchestratorRef | undefined,
  deps: TaskStartStopDeps,
  mutation: StopMutation,
  options: { cancelled?: boolean; patch?: TaskStartRunPatch } = {}
): Promise<TaskStartRun | null> {
  const { store } = deps.lifecycle
  stopTaskStartWatcher(store, run.id)
  // Without a ref, a start that died in this process published nothing to close.
  const ended = ref ? await stopOrchestration(run, ref, deps, mutation) : true
  const settled = ended
    ? store.transition(run.id, ['stopping'], {
        ...options.patch,
        state: 'stopped',
        failure: options.cancelled || !ref ? 'cancelled' : undefined
      })
    : store.transition(run.id, ['stopping'], {
        ...options.patch,
        launch: 'published',
        orchestrator: ref,
        failure: 'stop-unconfirmed'
      })
  return settled ?? store.getById(run.id)
}

/** ⏹: ends the card's orchestrator and its workers; never the worktree, branch or commits.
 *  An unproven end leaves the run `stopping` (`stop-unconfirmed`), and a repeat retries it;
 *  `force` then lets the card go (`stopped`, note `stop-forced`), though agents may live on. */
export async function stopTaskStartRun(
  cardKey: string,
  deps: TaskStartStopDeps,
  mutation: StopMutation,
  options: { preview?: boolean; force?: boolean } = {}
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
  let current = await settleStoppingTaskStartRun(stopping, stopping.orchestrator, deps, mutation)
  if (options.force && current?.state === 'stopping') {
    current =
      store.transition(run.id, ['stopping'], {
        state: 'stopped',
        failure: 'stop-unconfirmed',
        note: 'stop-forced'
      }) ?? store.getById(run.id)
  }
  return { ok: true, run: current ? summarizeTaskStartRun(current) : null }
}
