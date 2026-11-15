import { describe, expect, it } from 'vitest'
import type { AgentSessionStatusEvent } from '../../shared/agent-session/agent-session-wire'
import type {
  TaskStartOrchestratorRef,
  TaskStartRun,
  TaskStartRunState
} from '../../shared/task-board/task-start-run'
import type { PtyLivenessVerdict } from '../../shared/terminal/pty/lifecycle/pty-liveness-verdict'
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
      ptyIdForHandle: notUsed,
      paneBinding: notUsed,
      ptyLiveness: notUsed,
      agentPresence: notUsed,
      subscribeExit: notUsed,
      subscribeAgentExited: notUsed,
      ...overrides.terminal
    },
    chat: {
      liveness: notUsed,
      liveSessionId: notUsed,
      subscribeTabHidden: notUsed,
      subscribeStatus: notUsed,
      ...overrides.chat
    }
  }
}

const terminalRef: TaskStartOrchestratorRef = {
  hostId: 'local',
  agent: 'claude',
  worktreeId: 'wt-1',
  surface: 'terminal',
  handle: 'term_1',
  paneKey: 'tab-1:leaf-1',
  ptyId: 'pty-1'
}

const chatRef: TaskStartOrchestratorRef = {
  hostId: 'local',
  agent: 'claude',
  worktreeId: 'wt-1',
  surface: 'chat',
  sessionId: 'session-1'
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

/** Terminal deps whose PTY exit the test fires by hand, leaving the host's verdict behind. */
function exitableTerminal(): {
  terminal: Partial<TaskStartLifecycleDeps['terminal']>
  exit: (verdict: PtyLivenessVerdict) => void
  watching: () => number
} {
  const listeners = new Set<() => void>()
  let current: PtyLivenessVerdict | null = null
  return {
    terminal: {
      ptyLiveness: () => current,
      subscribeExit: (_ptyId, listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      subscribeAgentExited: () => () => {}
    },
    exit: (verdict) => {
      current = verdict
      listeners.forEach((listener) => listener())
    },
    watching: () => listeners.size
  }
}

describe('task start orchestrator watcher', () => {
  it('fails a running run when its orchestrator terminal exits', () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef)
    const pty = exitableTerminal()
    watchTaskStartOrchestrator(run, lifecycleDeps(store, { terminal: pty.terminal }))
    pty.exit({ status: 'exited' })

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('leaves a stopping run stopping when its orchestrator terminal exits', () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef, 'stopping')
    const pty = exitableTerminal()
    watchTaskStartOrchestrator(run, lifecycleDeps(store, { terminal: pty.terminal }))
    pty.exit({ status: 'exited' })

    expect(store.getById(run.id)).toMatchObject({ state: 'stopping' })
    expect(store.getById(run.id)?.failure).toBeUndefined()
  })

  it('keeps a running run when its terminal exit is not certified', () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef)
    const pty = exitableTerminal()
    watchTaskStartOrchestrator(run, lifecycleDeps(store, { terminal: pty.terminal }))
    pty.exit({ status: 'unverifiable', reason: 'the owning SSH host did not confirm the PTY exit' })

    expect(store.getById(run.id)).toMatchObject({ state: 'running' })
  })

  it('installs one watcher however often a run is watched', () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef)
    const pty = exitableTerminal()
    const deps = lifecycleDeps(store, { terminal: pty.terminal })
    watchTaskStartOrchestrator(run, deps)
    watchTaskStartOrchestrator(run, deps)

    expect(pty.watching()).toBe(1)
  })

  it('keeps a chat run when only the status subscription ends', () => {
    const store = memoryStore()
    const run = publishedRun(store, chatRef)
    let emit: (event: AgentSessionStatusEvent) => void = () => {}
    watchTaskStartOrchestrator(
      run,
      lifecycleDeps(store, {
        chat: {
          liveness: () => 'gone',
          subscribeTabHidden: () => () => {},
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

  it('fails a chat run when the tab of the session continuing it closes', () => {
    const store = memoryStore()
    const run = publishedRun(store, chatRef)
    let hide: (sessionId: string) => void = () => {}
    watchTaskStartOrchestrator(
      run,
      lifecycleDeps(store, {
        chat: {
          liveness: () => 'gone',
          liveSessionId: () => 'session-2',
          subscribeTabHidden: (listener) => {
            hide = listener
            return () => {}
          },
          subscribeStatus: () => null
        }
      })
    )
    hide('session-2')

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
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

  it('fails a running run whose orchestrator pane is gone', async () => {
    const store = memoryStore()
    const run = publishedRun(store, { ...terminalRef, ptyId: undefined })

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        terminal: { ptyIdForHandle: () => null, paneBinding: () => 'gone' }
      })
    )

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('fails a run whose agent exited back to a live shell', async () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef)

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        terminal: {
          ptyLiveness: () => ({ status: 'live', ptyIds: ['pty-1'] }),
          agentPresence: async () => 'exited'
        }
      })
    )

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('fails a run whose agent exited before its PTY has any verdict', async () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef)

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        terminal: {
          ptyLiveness: () => null,
          paneBinding: () => ({ ptyId: 'pty-1' }),
          agentPresence: async () => 'exited'
        }
      })
    )

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('fails a run whose recorded PTY has no verdict and whose pane is gone', async () => {
    const store = memoryStore()
    const run = publishedRun(store, terminalRef)

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        terminal: { ptyLiveness: () => null, paneBinding: () => 'gone' }
      })
    )

    expect(store.getById(run.id)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('keeps a run whose restored pane has no terminal bound yet', async () => {
    const store = memoryStore()
    const run = publishedRun(store, { ...terminalRef, ptyId: undefined })

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        terminal: { ptyIdForHandle: () => null, paneBinding: () => ({ ptyId: null }) }
      })
    )

    expect(store.getById(run.id)).toEqual(run)
  })

  it('keeps a run whose orchestrator host cannot be reached', async () => {
    const store = memoryStore()
    const run = publishedRun(store, { ...terminalRef, hostId: 'ssh:box', ptyId: undefined })

    await reconcileTaskStartRuns(
      lifecycleDeps(store, {
        hostReachable: () => false,
        terminal: { ptyIdForHandle: () => null, paneBinding: () => 'gone' }
      })
    )

    expect(store.getById(run.id)).toEqual(run)
  })
})
