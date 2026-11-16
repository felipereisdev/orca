import { describe, expect, it, vi } from 'vitest'
import type { AgentLaunchResult } from '../../shared/agent-launch/contracts/agent-launch-intent'
import type { Repo } from '../../shared/repo-types'
import type { TaskBoardCardRef } from '../../shared/task-board/task-board-wire-types'
import type { TaskStartRun } from '../../shared/task-board/task-start-run'
import { reconcileTaskStartRuns, type TaskStartLifecycleDeps } from './task-start-lifecycle'
import type { TaskStartOptionsDeps } from './task-start-options'
import { createTaskStartRunStore, type TaskStartRunStore } from './task-start-run-store'
import { startTaskFromCard, type TaskStartServiceDeps } from './task-start-service'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const REPO: Repo = { id: 'web', path: '/src/web', displayName: 'web', badgeColor: '', addedAt: 1 }

function ref(number: number): TaskBoardCardRef {
  return { provider: 'github', repoId: 'web', number, issueRepo: null }
}

function memoryStore(): TaskStartRunStore {
  let runs: Record<string, TaskStartRun> = {}
  return createTaskStartRunStore({
    read: () => runs,
    write: (next) => {
      runs = next
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    emit: () => {}
  })
}

function lifecycle(store: TaskStartRunStore): TaskStartLifecycleDeps {
  return {
    store,
    hostReachable: () => true,
    terminal: {
      ptyIdForHandle: () => null,
      paneBinding: () => 'unknown',
      ptyLiveness: () => null,
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
}

const account = {
  id: 'acc-1',
  email: 'a@example.com',
  authMethod: 'subscription-oauth' as const,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
}

function options(overrides: Partial<TaskStartOptionsDeps> = {}): TaskStartOptionsDeps {
  return {
    repos: () => [REPO],
    settings: () => ({ taskStart: { roles: {} }, defaultTuiAgent: 'claude' }),
    jiraIssue: async () => null,
    baseRefDefault: async () => 'origin/main',
    launchHost: async () => ({
      agents: ['claude'],
      claudeAccountTarget: { runtime: 'host', wslDistro: null }
    }),
    claudeAccounts: () => [account],
    modelCatalog: async () => ({ origin: 'unknown' }),
    ...overrides
  }
}

function launched(prompt: 'journaled' | 'not-delivered' = 'journaled'): AgentLaunchResult {
  return {
    outcome: { kind: 'terminal', handle: 'term-1', paneKey: 'tab-1:leaf-1' },
    worktreeId: 'wt-new',
    receipt: { mode: 'terminal', preferred: 'terminal', reason: 'requested', detail: '' },
    prompt:
      prompt === 'journaled'
        ? { delivery: 'submit', outcome: 'journaled', messageId: 'm1' }
        : { delivery: 'submit', outcome: 'not-delivered' }
  }
}

function serviceDeps(
  store: TaskStartRunStore,
  overrides: Partial<TaskStartServiceDeps> = {}
): TaskStartServiceDeps {
  return {
    options: options(),
    lifecycle: lifecycle(store),
    cardKey: (r) => `github:local:web:${'number' in r ? r.number : 0}`,
    readContext: async (r) => ({
      card: { ref: r, provider: 'github', displayId: '#7', title: 'Fix it', url: 'https://x/7' },
      context: {
        displayId: '#7',
        title: 'Fix it',
        url: 'https://x/7',
        provider: 'github',
        description: 'body',
        comments: [],
        images: []
      }
    }),
    writeImages: async ({ images }) => images,
    primaryWorktreeId: async () => 'wt-main',
    gitStatus: async () => ({ entries: [], branch: 'main' }),
    createWorktree: vi.fn(async () => ({ worktreeId: 'wt-new' })),
    launchAgent: vi.fn(async (_params, onSurfacePublished) => {
      const result = launched()
      onSurfacePublished(result)
      return result
    }),
    terminalIdentity: () => ({ ptyId: 'pty-1' }),
    closeOrchestrator: vi.fn(async () => {}),
    orchestration: {
      fence: () => {},
      liveWorkers: () => [],
      stopWorker: async (dispatchId) => ({
        dispatchId,
        state: 'stopped',
        alreadySettled: false,
        processAction: 'none'
      }),
      pendingStarts: () => 0
    },
    stopMutation: () => ({
      callerFingerprint: 'test',
      requestId: 'req-1',
      method: 'taskBoard.stopTask',
      payloadHash: ''
    }),
    ...overrides
  }
}

describe('startTaskFromCard', () => {
  it('refuses a second start of the card while the first is still collecting context', async () => {
    const store = memoryStore()
    const context = deferred<void>()
    const base = serviceDeps(store)
    const deps = serviceDeps(store, {
      readContext: async (r) => {
        await context.promise
        return base.readContext(r)
      }
    })
    const first = startTaskFromCard({ ref: ref(7) }, deps)
    await vi.waitFor(() => expect(store.listExclusive()).toHaveLength(1))
    await reconcileTaskStartRuns(deps.lifecycle)
    expect(await startTaskFromCard({ ref: ref(7) }, deps)).toMatchObject({
      ok: false,
      error: 'already_running'
    })
    context.resolve()
    expect((await first).ok).toBe(true)
  })

  it('cancels when a stop arrives while the worktree is being created', async () => {
    const store = memoryStore()
    const worktree = deferred<{ worktreeId: string }>()
    const deps = serviceDeps(store, { createWorktree: vi.fn(() => worktree.promise) })
    const start = startTaskFromCard({ ref: ref(7) }, deps)
    await vi.waitFor(() => expect(deps.createWorktree).toHaveBeenCalled())
    const [run] = store.listExclusive()
    store.transition(run.id, ['running', 'waiting'], { state: 'stopping' })
    worktree.resolve({ worktreeId: 'wt-new' })
    expect(await start).toMatchObject({ ok: false, error: 'cancelled' })
    expect(deps.launchAgent).not.toHaveBeenCalled()
    expect(store.getById(run.id)?.state).toBe('stopped')
  })

  it('keeps a cancelled start stopping when its published orchestrator fails to close', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store, {
      launchAgent: vi.fn(async (params, onSurfacePublished) => {
        const result = launched()
        onSurfacePublished(result)
        // ⏹ lands while the prompt is being delivered.
        store.transition(params.operationId ?? '', ['running', 'waiting'], { state: 'stopping' })
        return result
      }),
      closeOrchestrator: vi.fn(async () => {
        throw new Error('terminal close failed')
      })
    })
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(result).toMatchObject({ ok: false, error: 'cancelled' })
    const runId = vi.mocked(deps.launchAgent).mock.calls[0][0].operationId ?? ''
    expect(store.getById(runId)).toMatchObject({
      state: 'stopping',
      failure: 'stop-unconfirmed',
      orchestrator: { handle: 'term-1' }
    })
  })

  it('refuses a role whose Claude account needs sign-in before claiming anything', async () => {
    const store = memoryStore()
    const claim = vi.spyOn(store, 'claim')
    const deps = serviceDeps(store, {
      options: options({ claudeAccounts: () => [{ ...account, needsSignIn: true }] })
    })
    const result = await startTaskFromCard(
      { ref: ref(7), roles: { reviewer: { agent: 'claude', accountId: 'acc-1' } } },
      deps
    )
    expect(result).toMatchObject({ ok: false, error: 'account_needs_sign_in' })
    expect(claim).not.toHaveBeenCalled()
    expect(deps.createWorktree).not.toHaveBeenCalled()
  })

  it('refuses a managed Claude account on an SSH project before claiming anything', async () => {
    const store = memoryStore()
    const claim = vi.spyOn(store, 'claim')
    const deps = serviceDeps(store, {
      options: options({ repos: () => [{ ...REPO, connectionId: 'box' }] })
    })
    const result = await startTaskFromCard(
      { ref: ref(7), roles: { qa: { agent: 'claude', accountId: 'acc-1' } } },
      deps
    )
    expect(result).toMatchObject({ ok: false, error: 'remote_account_unsupported', role: 'qa' })
    expect(claim).not.toHaveBeenCalled()
    expect(deps.createWorktree).not.toHaveBeenCalled()
  })

  it('keeps the primary checkout to one card and asks before using a dirty one', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store)
    expect((await startTaskFromCard({ ref: ref(1), workspaceMode: 'primary' }, deps)).ok).toBe(true)
    expect(await startTaskFromCard({ ref: ref(2), workspaceMode: 'primary' }, deps)).toMatchObject({
      ok: false,
      error: 'primary_busy'
    })

    const dirtyStore = memoryStore()
    const dirty = serviceDeps(dirtyStore, {
      gitStatus: async () => ({ entries: [{ path: 'a.ts' }], branch: 'main' })
    })
    expect(await startTaskFromCard({ ref: ref(3), workspaceMode: 'primary' }, dirty)).toEqual({
      ok: false,
      error: 'primary_needs_confirmation',
      reasons: ['uncommitted']
    })
    const confirmed = await startTaskFromCard(
      { ref: ref(3), workspaceMode: 'primary', confirmPrimary: true },
      dirty
    )
    expect(confirmed.ok).toBe(true)
    expect(dirty.createWorktree).not.toHaveBeenCalled()
    expect(vi.mocked(dirty.launchAgent).mock.calls[0][0].target).toEqual({
      kind: 'existing',
      worktree: 'id:wt-main'
    })
  })

  it('launches the orchestrator under the run id with its account, model and effort', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store)
    const result = await startTaskFromCard(
      {
        ref: ref(7),
        roles: {
          orchestrator: { agent: 'claude', accountId: 'acc-1', model: 'opus', effort: 'high' }
        }
      },
      deps
    )
    expect(result.ok).toBe(true)
    const runId = result.ok ? result.run.id : ''
    const [params] = vi.mocked(deps.launchAgent).mock.calls[0]
    expect(params).toMatchObject({
      operationId: runId,
      agent: 'claude',
      claudeAccountId: 'acc-1',
      target: { kind: 'existing', worktree: 'id:wt-new' },
      sessionOptions: { model: 'opus', effort: 'high' }
    })
    const run = store.getById(runId)
    expect(run).toMatchObject({ launch: 'published', state: 'running', worktreeId: 'wt-new' })
    expect(run?.orchestrator).toMatchObject({
      hostId: 'local',
      surface: 'terminal',
      paneKey: 'tab-1:leaf-1',
      ptyId: 'pty-1'
    })
  })

  it('reports an orchestrator that exits during prompt delivery as failed, not cancelled', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store, {
      launchAgent: vi.fn(async (params, onSurfacePublished) => {
        const result = launched()
        onSurfacePublished(result)
        // The watcher certifies the exit while the prompt is still being delivered.
        store.transition(params.operationId ?? '', ['running', 'waiting'], {
          state: 'failed',
          failure: 'orchestrator-exited'
        })
        return result
      })
    })
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(result).toMatchObject({ ok: false, error: 'launch_failed' })
    expect(deps.closeOrchestrator).not.toHaveBeenCalled()
    expect(store.listExclusive()).toEqual([])
    const runId = vi.mocked(deps.launchAgent).mock.calls[0][0].operationId ?? ''
    expect(store.getById(runId)).toMatchObject({
      state: 'failed',
      failure: 'orchestrator-exited'
    })
  })

  it('keeps a published orchestrator running when its prompt is not confirmed', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store, {
      launchAgent: vi.fn(async (_params, onSurfacePublished) => {
        const result = launched('not-delivered')
        onSurfacePublished(result)
        return result
      })
    })
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(result.ok).toBe(true)
    expect(store.getById(result.ok ? result.run.id : '')).toMatchObject({
      state: 'running',
      launch: 'published',
      note: 'prompt-unconfirmed'
    })
  })
})
