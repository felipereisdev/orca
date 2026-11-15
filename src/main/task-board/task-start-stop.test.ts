import { describe, expect, it } from 'vitest'
import type { WorkerStopReceipt } from '../../shared/orchestration/workers/orchestration-worker-stop-receipt'
import type { TaskStartOrchestratorRef, TaskStartRun } from '../../shared/task-board/task-start-run'
import type { PtyLivenessVerdict } from '../../shared/terminal/pty/lifecycle/pty-liveness-verdict'
import type { TaskStartLifecycleDeps } from './task-start-lifecycle'
import { createTaskStartRunStore, type TaskStartRunStore } from './task-start-run-store'
import { stopTaskStartRun, type TaskStartStopDeps } from './task-start-stop'

const CARD = 'jira:a:APP-1'

const orchestrator: TaskStartOrchestratorRef = {
  hostId: 'local',
  agent: 'claude',
  worktreeId: 'wt-1',
  surface: 'terminal',
  handle: 'term_orch',
  paneKey: 'tab-1:leaf-1',
  ptyId: 'pty-orch'
}

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

function publishedRun(store: TaskStartRunStore): TaskStartRun {
  const claimed = store.claim({ cardKey: CARD, repoId: 'r', workspaceMode: 'worktree' })
  if (!claimed.ok) {
    throw new Error('claim failed')
  }
  const run = store.transition(claimed.run.id, ['running'], {
    launch: 'published',
    orchestrator,
    phase: 'development'
  })
  if (!run) {
    throw new Error('publish failed')
  }
  return run
}

function stopped(dispatchId: string): WorkerStopReceipt {
  return {
    dispatchId,
    state: 'stopped',
    alreadySettled: false,
    processAction: 'closed_agent_terminal'
  }
}

/** Two Runs bound to the orchestrator, three live workers and one already finished. */
function harness(receipt: (dispatchId: string) => WorkerStopReceipt = stopped) {
  const store = memoryStore()
  const calls: string[] = []
  let pty: PtyLivenessVerdict = { status: 'live', ptyIds: ['pty-orch'] }
  const workersByRun: Record<string, { dispatchId: string; workerState: string }[]> = {
    run_a: [
      { dispatchId: 'w1', workerState: 'ready' },
      { dispatchId: 'w0', workerState: 'succeeded' },
      { dispatchId: 'w2', workerState: 'ready' }
    ],
    run_b: [{ dispatchId: 'w3', workerState: 'starting' }]
  }
  const lifecycle: TaskStartLifecycleDeps = {
    store,
    hostReachable: () => true,
    terminal: {
      ptyIdForHandle: () => 'pty-orch',
      paneBinding: () => 'unknown',
      ptyLiveness: () => pty,
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
      pty = { status: 'exited' }
    },
    orchestration: {
      boundRunIds: (key) => (key.paneKey === orchestrator.paneKey ? ['run_a', 'run_b'] : []),
      workers: (runId) => workersByRun[runId] ?? [],
      stopWorker: async (dispatchId) => {
        calls.push(`stop:${dispatchId}`)
        return receipt(dispatchId)
      }
    }
  }
  return { store, deps, calls, run: publishedRun(store) }
}

describe('stopTaskStartRun', () => {
  it('closes the orchestrator before stopping every worker of all its Runs', async () => {
    const { store, deps, calls, run } = harness()

    const result = await stopTaskStartRun(CARD, deps, undefined)

    expect(calls[0]).toBe('close')
    expect(calls.slice(1).sort()).toEqual(['stop:w1', 'stop:w2', 'stop:w3'])
    expect(result.run?.state).toBe('stopped')
    expect(store.getById(run.id)?.state).toBe('stopped')
  })

  it('keeps the run stopping when a worker stop is unproven, and a repeat settles it', async () => {
    let proven = false
    const { store, deps, run } = harness((dispatchId) =>
      dispatchId === 'w2' && !proven
        ? { dispatchId, state: 'stop_unknown', alreadySettled: false, processAction: 'unknown' }
        : stopped(dispatchId)
    )

    await stopTaskStartRun(CARD, deps, undefined)
    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })

    proven = true
    await expect(stopTaskStartRun(CARD, deps, undefined)).resolves.toMatchObject({
      run: { state: 'stopped' }
    })
  })

  it('previews the orchestrator and its live workers without stopping anything', async () => {
    const { store, deps, calls, run } = harness()

    const result = await stopTaskStartRun(CARD, deps, undefined, { preview: true })

    expect(result.agents).toBe(4)
    expect(calls).toEqual([])
    expect(store.getById(run.id)?.state).toBe('running')
  })
})
