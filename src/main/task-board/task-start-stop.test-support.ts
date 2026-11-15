import type { WorkerStopReceipt } from '../../shared/orchestration/workers/orchestration-worker-stop-receipt'
import type { TaskStartOrchestratorRef, TaskStartRun } from '../../shared/task-board/task-start-run'
import type { PtyLivenessVerdict } from '../../shared/terminal/pty/lifecycle/pty-liveness-verdict'
import { countReservedRemoteStartsCreatedBy } from '../runtime/orchestration/db/remote-owned/remote-owned-creator-listing'
import { fenceCoordinator } from '../runtime/orchestration/workers/launch/coordinator-start-fence'
import { createOrchestrationWorkerReleaseHarness } from '../runtime/rpc/methods/orchestration/worker/testing/worker-release.test-support'
import type { TaskStartLifecycleDeps } from './task-start-lifecycle'
import { createTaskStartRunStore, type TaskStartRunStore } from './task-start-run-store'
import type { TaskStartStopDeps } from './task-start-stop'
import { listTaskStartWorkers } from './task-start-stop-deps'

export const CARD = 'jira:a:APP-1'
export const OTHER_PANE = 'tab_other:cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/** One per test file: the real runtime and in-memory orchestration database behind each stop. */
export const h = createOrchestrationWorkerReleaseHarness()

function memoryStore(): TaskStartRunStore {
  let runs: Record<string, TaskStartRun> = {}
  return createTaskStartRunStore({
    read: () => runs,
    write: (next) => {
      runs = next
    },
    now: () => new Date('2026-11-15T10:00:00.000Z'),
    emit: () => {}
  })
}

export function stopped(dispatchId: string): WorkerStopReceipt {
  return {
    dispatchId,
    state: 'stopped',
    alreadySettled: false,
    processAction: 'closed_agent_terminal'
  }
}

/** A ready worker Dispatch, as worker-start leaves it, created by `handle` in `runId`. */
export function createWorker(runId: string, handle = 'term_coord', paneKey = h.coordinatorPaneKey) {
  const task = h.db.createTask({ runId, spec: 'subtask' })
  const { dispatch } = h.db.createStartingWorkerDispatch({
    creator: { kind: 'terminal', handle, paneKey },
    maxDepth: 10,
    taskId: task.id,
    startOptions: {}
  })
  h.db.markWorkerDispatchReady(dispatch.id)
  return dispatch.id
}

/** The orchestrator `term_coord` created two workers in its first Run, then bound a second Run
 *  (which unbinds the first) and created a third; another coordinator created one more. */
export function stopHarness(
  hooks: {
    receipt?: (dispatchId: string) => WorkerStopReceipt
    onClose?: () => Promise<void>
    onProbe?: () => void
    orchestrator?: TaskStartOrchestratorRef
    liveWorkers?: TaskStartStopDeps['orchestration']['liveWorkers']
  } = {}
) {
  h.setup()
  const store = memoryStore()
  const calls: string[] = []
  const firstRun = h.activeRunId
  const workers = [createWorker(firstRun), createWorker(firstRun)]
  const secondRun = h.db.createRun({
    objective: 'Second Run',
    coordinatorHandle: 'term_coord',
    coordinatorPaneKey: h.coordinatorPaneKey
  }).id
  h.db.bindRun({
    runId: secondRun,
    coordinatorHandle: 'term_coord',
    coordinatorPaneKey: h.coordinatorPaneKey
  })
  workers.push(createWorker(secondRun))
  createWorker(secondRun, 'term_other', OTHER_PANE)
  const orchestrator: TaskStartOrchestratorRef = hooks.orchestrator ?? {
    hostId: 'local',
    agent: 'claude',
    worktreeId: 'wt-1',
    surface: 'terminal',
    handle: 'term_coord',
    paneKey: h.coordinatorPaneKey,
    ptyId: 'pty-orch'
  }
  let pty: PtyLivenessVerdict = { status: 'live', ptyIds: ['pty-orch'] }
  const lifecycle: TaskStartLifecycleDeps = {
    store,
    hostReachable: () => true,
    terminal: {
      ptyIdForHandle: () => 'pty-orch',
      paneBinding: () => 'unknown',
      ptyLiveness: () => {
        hooks.onProbe?.()
        return pty
      },
      agentPresence: async () => null,
      subscribeExit: () => () => {},
      subscribeAgentExited: () => () => {}
    },
    chat: {
      liveness: () => (pty.status === 'exited' ? 'gone' : 'alive'),
      liveSessionId: () => null,
      subscribeTabHidden: () => () => {},
      subscribeStatus: () => null
    }
  }
  const deps: TaskStartStopDeps = {
    lifecycle,
    closeOrchestrator: async () => {
      calls.push('close')
      await hooks.onClose?.()
      pty = { status: 'exited' }
    },
    orchestration: {
      fence: (coordinator) => fenceCoordinator(h.runtime, coordinator),
      liveWorkers: hooks.liveWorkers ?? ((coordinator) => listTaskStartWorkers(h.db, coordinator)),
      stopWorker: async (dispatchId) => {
        calls.push(dispatchId)
        const receipt = (hooks.receipt ?? stopped)(dispatchId)
        if (receipt.state === 'stopped') {
          h.db.beginWorkerStop(dispatchId, h.runtime.getRuntimeId())
          h.db.settleWorkerStop(dispatchId)
        }
        return receipt
      },
      pendingStarts: (coordinator) => countReservedRemoteStartsCreatedBy(h.db, coordinator)
    }
  }
  const claimed = store.claim({ cardKey: CARD, repoId: 'r', workspaceMode: 'worktree' })
  if (!claimed.ok) {
    throw new Error('claim failed')
  }
  const run = store.transition(claimed.run.id, ['running'], {
    launch: 'published',
    orchestrator,
    phase: 'development'
  })!
  return { store, deps, calls, run, workers, firstRun, secondRun }
}
