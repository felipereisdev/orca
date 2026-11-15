import { afterEach, describe, expect, it } from 'vitest'
import type { WorkerStopReceipt } from '../../shared/orchestration/workers/orchestration-worker-stop-receipt'
import type { TaskStartOrchestratorRef, TaskStartRun } from '../../shared/task-board/task-start-run'
import type { PtyLivenessVerdict } from '../../shared/terminal/pty/lifecycle/pty-liveness-verdict'
import { fenceCoordinator } from '../runtime/orchestration/workers/launch/coordinator-start-fence'
import { createOrchestrationWorkerReleaseHarness } from '../runtime/rpc/methods/orchestration/worker/testing/worker-release.test-support'
import type { TaskStartLifecycleDeps } from './task-start-lifecycle'
import { createTaskStartRunStore, type TaskStartRunStore } from './task-start-run-store'
import { stopTaskStartRun, type TaskStartStopDeps } from './task-start-stop'

const CARD = 'jira:a:APP-1'
const OTHER_PANE = 'tab_other:cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const h = createOrchestrationWorkerReleaseHarness()

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

function stopped(dispatchId: string): WorkerStopReceipt {
  return {
    dispatchId,
    state: 'stopped',
    alreadySettled: false,
    processAction: 'closed_agent_terminal'
  }
}

/** A ready worker Dispatch, as worker-start leaves it, created by `handle` in `runId`. */
function createWorker(runId: string, handle = 'term_coord', paneKey = h.coordinatorPaneKey) {
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
function harness(
  hooks: {
    receipt?: (dispatchId: string) => WorkerStopReceipt
    onClose?: () => Promise<void>
    onProbe?: () => void
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
  const orchestrator: TaskStartOrchestratorRef = {
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
      liveness: () => 'unverifiable',
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
      liveWorkers:
        hooks.liveWorkers ??
        ((coordinator) => h.db.listLiveWorkerDispatchIdsCreatedBy(coordinator)),
      stopWorker: async (dispatchId) => {
        calls.push(dispatchId)
        const receipt = (hooks.receipt ?? stopped)(dispatchId)
        if (receipt.state === 'stopped') {
          h.db.beginWorkerStop(dispatchId, h.runtime.getRuntimeId())
          h.db.settleWorkerStop(dispatchId)
        }
        return receipt
      }
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
  return { store, deps, calls, run, workers, secondRun }
}

describe('stopTaskStartRun', () => {
  afterEach(() => h.cleanup())

  it('closes the orchestrator, then stops every worker it created in any of its Runs', async () => {
    const { store, deps, calls, run, workers, secondRun } = harness()
    expect(
      h.db
        .runsBoundToCoordinator({
          terminalHandle: 'term_coord',
          paneKey: h.coordinatorPaneKey,
          orcaSessionId: null
        })
        .map((bound) => bound.id)
    ).toEqual([secondRun])

    const result = await stopTaskStartRun(CARD, deps, undefined)

    expect(calls[0]).toBe('close')
    expect(calls.slice(1).sort()).toEqual([...workers].sort())
    expect(result.run?.state).toBe('stopped')
    expect(store.getById(run.id)?.state).toBe('stopped')
  })

  it('refuses a worker start from the orchestrator once the stop has begun', async () => {
    let refusal: unknown
    const { deps, calls, workers, secondRun } = harness({
      onClose: async () => {
        const task = h.db.createTask({ spec: 'one more subtask', runId: secondRun })
        refusal = await h
          .call('orchestration.workerStart', { task: task.id, from: 'term_coord', agent: 'claude' })
          .then(() => 'started')
          .catch((error: unknown) => error)
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(refusal).toMatchObject({ code: 'coordinator_stopped' })
    expect(calls.slice(1).sort()).toEqual([...workers].sort())
  })

  it('stops a worker that appears after the first listing', async () => {
    let late: string | undefined
    const { store, deps, calls, run, secondRun } = harness({
      onProbe: () => {
        late ??= createWorker(secondRun)
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(calls).toContain(late)
    expect(store.getById(run.id)?.state).toBe('stopped')
  })

  it('keeps the run stopping when the workers cannot be listed', async () => {
    const { store, deps, run } = harness({
      liveWorkers: () => {
        throw new Error('database is locked')
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })
  })

  it('keeps the run stopping when a worker stop is unproven, and a repeat settles it', async () => {
    let proven = false
    let unproven: string | undefined
    const { store, deps, run } = harness({
      receipt: (dispatchId) => {
        unproven ??= dispatchId
        return dispatchId === unproven && !proven
          ? { dispatchId, state: 'stop_unknown', alreadySettled: false, processAction: 'unknown' }
          : stopped(dispatchId)
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)
    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })

    proven = true
    await expect(stopTaskStartRun(CARD, deps, undefined)).resolves.toMatchObject({
      run: { state: 'stopped' }
    })
  })

  it('previews the orchestrator and the workers it created without stopping anything', async () => {
    const { store, deps, calls, run } = harness()

    const result = await stopTaskStartRun(CARD, deps, undefined, { preview: true })

    expect(result.agents).toBe(4)
    expect(calls).toEqual([])
    expect(store.getById(run.id)?.state).toBe('running')
  })
})
