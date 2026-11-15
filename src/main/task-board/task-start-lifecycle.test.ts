import { describe, expect, it } from 'vitest'
import type { AgentSessionStatusEvent } from '../../shared/agent-session/agent-session-wire'
import type {
  TaskStartOrchestratorRef,
  TaskStartRun,
  TaskStartRunState
} from '../../shared/task-board/task-start-run'
import {
  reconcileTaskStartRuns,
  watchTaskStartOrchestrator,
  type TaskStartLifecycleDeps
} from './task-start-lifecycle'
import { createTaskStartRunStore, type TaskStartRunStore } from './task-start-run-store'

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

function notUsed(): never {
  throw new Error('not used in this scenario')
}

function lifecycleDeps(
  store: TaskStartRunStore,
  overrides: {
    hostReachable?: TaskStartLifecycleDeps['hostReachable']
    terminal?: Partial<TaskStartLifecycleDeps['terminal']>
    chat?: Partial<TaskStartLifecycleDeps['chat']>
  } = {}
): TaskStartLifecycleDeps {
  return {
    store,
    hostReachable: overrides.hostReachable ?? (() => true),
    terminal: {
      show: notUsed,
      handleForPaneKey: notUsed,
      liveness: notUsed,
      waitForExit: notUsed,
      ...overrides.terminal
    },
    chat: { liveness: notUsed, subscribeStatus: notUsed, ...overrides.chat }
  }
}

const terminalRef: TaskStartOrchestratorRef = {
  hostId: 'local',
  agent: 'claude',
  worktreeId: 'wt-1',
  surface: 'terminal',
  handle: 'term_1',
  paneKey: 'tab-1:leaf-1'
}

function publishedRun(
  store: TaskStartRunStore,
  orchestrator: TaskStartOrchestratorRef,
  state: TaskStartRunState = 'running'
): TaskStartRun {
  const claimed = store.claim({ cardKey: 'jira:a:APP-1', repoId: 'r', workspaceMode: 'worktree' })
  if (!claimed.ok) {
    throw new Error('claim failed')
  }
  const run = store.transition(claimed.run.id, ['running'], {
    launch: 'published',
    orchestrator,
    state
  })
  if (!run) {
    throw new Error('publish failed')
  }
  return run
}

function deferred(): { promise: Promise<unknown>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<unknown>((done) => {
    resolve = () => done({ status: 'exited' })
  })
  return { promise, resolve }
}

describe('task start orchestrator watcher', () => {
  it('fails a running run when its orchestrator terminal exits', async () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef)
    const exit = deferred()
    watchTaskStartOrchestrator(
      run,
      lifecycleDeps(store, { terminal: { waitForExit: () => exit.promise } })
    )
    exit.resolve()
    await exit.promise
    await Promise.resolve()

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('leaves a stopping run stopping when its orchestrator terminal exits', async () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef, 'stopping')
    const exit = deferred()
    watchTaskStartOrchestrator(
      run,
      lifecycleDeps(store, { terminal: { waitForExit: () => exit.promise } })
    )
    exit.resolve()
    await exit.promise
    await Promise.resolve()

    expect(store.getById(run.id)).toMatchObject({ state: 'stopping' })
    expect(store.getById(run.id)?.failure).toBeUndefined()
  })

  it('keeps a chat run when only the status subscription ends', () => {
    const store = memoryStore()
    const run = publishedRun(store, {
      hostId: 'local',
      agent: 'claude',
      worktreeId: 'wt-1',
      surface: 'chat',
      sessionId: 'session-1'
    })
    let emit: (event: AgentSessionStatusEvent) => void = () => {}
    watchTaskStartOrchestrator(
      run,
      lifecycleDeps(store, {
        chat: {
          liveness: () => 'alive',
          subscribeStatus: (listener) => {
            emit = listener
            return () => {}
          }
        }
      })
    )
    emit({ type: 'end' })

    expect(store.getById(run.id)).toMatchObject({ state: 'running' })
  })
})

describe('task start reconciliation', () => {
  it('leaves a start still in flight in this process untouched', async () => {
    const store = memoryStore()
    const claimed = store.claim({ cardKey: 'jira:a:APP-1', repoId: 'r', workspaceMode: 'worktree' })
    if (!claimed.ok) {
      throw new Error('claim failed')
    }
    store.inFlight.add(claimed.run.id)

    await reconcileTaskStartRuns(lifecycleDeps(store))

    expect(store.getById(claimed.run.id)).toEqual(claimed.run)
  })

  it('fails a running run whose orchestrator terminal is gone', async () => {
    const store = memoryStore()
    const run = publishedRun(store, { ...terminalRef, paneKey: undefined })

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        terminal: {
          show: async () => {
            throw new Error('terminal_handle_stale')
          }
        }
      })
    )

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('keeps a run whose orchestrator host cannot be reached', async () => {
    const store = memoryStore()
    const run = publishedRun(store, { ...terminalRef, hostId: 'ssh:box', paneKey: undefined })

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        hostReachable: () => false,
        terminal: {
          show: async () => {
            throw new Error('terminal_handle_stale')
          }
        }
      })
    )

    expect(store.getById(run.id)).toEqual(run)
  })
})
