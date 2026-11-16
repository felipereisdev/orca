import { describe, expect, it, vi } from 'vitest'
import type { AgentLaunchResult } from '../../shared/agent-launch/contracts/agent-launch-intent'
import type { Repo } from '../../shared/repository/repo-types'
import type { TaskBoardCardRef } from '../../shared/task-board/task-board-wire-types'
import type { TaskStartRun } from '../../shared/task-board/task-start-run'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
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
    linearIssueProject: async () => null,
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
    remoteBase: vi.fn(async (_repo: Repo, base: string) => {
      const branch = /^origin\/(.+)$/.exec(base)?.[1]
      return branch ? { remote: 'origin', branch, ref: `refs/remotes/${base}`, base } : null
    }),
    baseUpstream: vi.fn(async () => null),
    fetchBase: vi.fn(async () => {}),
    createPrimaryBranch: vi.fn(async () => {}),
    createWorktree: vi.fn(async () => ({ worktreeId: 'wt-new' })),
    launchAgent: vi.fn(async (_params, onSurfacePublished) => {
      const result = launched()
      onSurfacePublished(result)
      return result
    }),
    terminalIdentity: () => ({ ptyId: 'pty-1' }),
    closeOrchestrator: vi.fn(async () => {}),
    renameOrchestrator: vi.fn(async () => {}),
    moveCard: vi.fn(async () => 'moved' as const),
    cardMoved: vi.fn(),
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

  it("names the orchestrator's tab after the card", async () => {
    const deps = serviceDeps(memoryStore())
    expect((await startTaskFromCard({ ref: ref(7) }, deps)).ok).toBe(true)
    expect(deps.renameOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'term-1' }),
      'Orquestrador · #7'
    )
  })

  it('starts the task even when naming its tab fails', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store, {
      renameOrchestrator: vi.fn(() => {
        throw new Error('rename failed')
      })
    })
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(result.ok).toBe(true)
    expect(deps.renameOrchestrator).toHaveBeenCalled()
    const run = store.getById(result.ok ? result.run.id : '')
    expect(run).toMatchObject({ state: 'running', launch: 'published' })
    expect(run?.note).toBeUndefined()
  })

  it('fetches the base from its remote before creating the worktree from the remote ref', async () => {
    const deps = serviceDeps(memoryStore())
    expect((await startTaskFromCard({ ref: ref(7) }, deps)).ok).toBe(true)
    expect(deps.fetchBase).toHaveBeenCalledWith(REPO, {
      remote: 'origin',
      branch: 'main',
      ref: 'refs/remotes/origin/main',
      base: 'origin/main'
    })
    expect(deps.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ baseBranch: 'origin/main' })
    )
    expect(vi.mocked(deps.fetchBase).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.createWorktree).mock.invocationCallOrder[0]
    )
  })

  it('creates the task branch in the primary checkout from the fetched base before launching', async () => {
    const deps = serviceDeps(memoryStore())
    const result = await startTaskFromCard(
      { ref: ref(7), workspaceMode: 'primary', baseRef: 'origin/develop', confirmPrimary: true },
      deps
    )
    expect(result.ok).toBe(true)
    expect(deps.createWorktree).not.toHaveBeenCalled()
    expect(deps.fetchBase).toHaveBeenCalledWith(
      REPO,
      expect.objectContaining({ branch: 'develop' })
    )
    expect(deps.createPrimaryBranch).toHaveBeenCalledWith({
      repo: REPO,
      worktreeId: 'wt-main',
      card: expect.objectContaining({ ref: ref(7), displayId: '#7' }),
      startPoint: 'origin/develop'
    })
    const [fetched] = vi.mocked(deps.fetchBase).mock.invocationCallOrder
    const [branched] = vi.mocked(deps.createPrimaryBranch).mock.invocationCallOrder
    const [launchedAt] = vi.mocked(deps.launchAgent).mock.invocationCallOrder
    expect(fetched).toBeLessThan(branched)
    expect(branched).toBeLessThan(launchedAt)
  })

  it('fails the start with primary_branch_failed when git refuses the task branch', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store, {
      createPrimaryBranch: vi.fn(async () => {
        throw new Error('Your local changes would be overwritten by checkout')
      })
    })
    const result = await startTaskFromCard({ ref: ref(7), workspaceMode: 'primary' }, deps)
    expect(result).toMatchObject({ ok: false, error: 'primary_branch_failed' })
    expect(deps.launchAgent).not.toHaveBeenCalled()
    const runId = result.ok ? '' : (result.run?.id ?? '')
    expect(store.getById(runId)).toMatchObject({
      state: 'failed',
      failure: 'worktree-create-failed'
    })
  })

  it('fails the start with base_update_failed when the base cannot be fetched', async () => {
    for (const workspaceMode of ['worktree', 'primary'] as const) {
      const store = memoryStore()
      const deps = serviceDeps(store, {
        fetchBase: vi.fn(async () => {
          throw new Error('Could not resolve host: github.com')
        })
      })
      const result = await startTaskFromCard({ ref: ref(7), workspaceMode }, deps)
      expect(result).toMatchObject({ ok: false, error: 'base_update_failed' })
      expect(deps.createWorktree).not.toHaveBeenCalled()
      expect(deps.createPrimaryBranch).not.toHaveBeenCalled()
      expect(deps.launchAgent).not.toHaveBeenCalled()
      const runId = result.ok ? '' : (result.run?.id ?? '')
      expect(store.getById(runId)).toMatchObject({
        state: 'failed',
        failure: 'worktree-create-failed'
      })
    }
  })

  it('starts from a local-only base without fetching', async () => {
    const deps = serviceDeps(memoryStore())
    expect((await startTaskFromCard({ ref: ref(7), baseRef: 'feature-x' }, deps)).ok).toBe(true)
    expect(deps.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ baseBranch: 'feature-x' })
    )
    const primary = serviceDeps(memoryStore(), {
      gitStatus: async () => ({ entries: [], branch: 'feature-x' })
    })
    const started = await startTaskFromCard(
      { ref: ref(7), workspaceMode: 'primary', baseRef: 'feature-x' },
      primary
    )
    expect(started.ok).toBe(true)
    expect(primary.createPrimaryBranch).toHaveBeenCalledWith(
      expect.objectContaining({ startPoint: 'feature-x' })
    )
    expect(deps.fetchBase).not.toHaveBeenCalled()
    expect(primary.fetchBase).not.toHaveBeenCalled()
  })

  it('creates no branch for a folder project', async () => {
    const folder: Repo = { ...REPO, kind: 'folder' }
    const deps = serviceDeps(memoryStore(), { options: options({ repos: () => [folder] }) })
    expect((await startTaskFromCard({ ref: ref(7) }, deps)).ok).toBe(true)
    expect(deps.createPrimaryBranch).not.toHaveBeenCalled()
    expect(deps.fetchBase).not.toHaveBeenCalled()
    expect(vi.mocked(deps.launchAgent).mock.calls[0][0].target).toEqual({
      kind: 'existing',
      worktree: 'id:wt-main'
    })
  })

  it("fetches a local base's upstream and starts from its remote ref", async () => {
    const upstream = {
      remote: 'origin',
      branch: 'develop',
      ref: 'refs/remotes/origin/develop',
      base: 'origin/develop'
    }
    for (const workspaceMode of ['worktree', 'primary'] as const) {
      const deps = serviceDeps(memoryStore(), {
        baseUpstream: vi.fn(async (_repo: Repo, base: string) =>
          base === 'develop' ? upstream : null
        ),
        gitStatus: async () => ({ entries: [], branch: 'develop' })
      })
      const result = await startTaskFromCard(
        { ref: ref(7), workspaceMode, baseRef: 'develop' },
        deps
      )
      expect(result.ok).toBe(true)
      expect(deps.fetchBase).toHaveBeenCalledWith(REPO, upstream)
      if (workspaceMode === 'worktree') {
        expect(deps.createWorktree).toHaveBeenCalledWith(
          expect.objectContaining({ baseBranch: 'origin/develop' })
        )
      } else {
        expect(deps.createPrimaryBranch).toHaveBeenCalledWith(
          expect.objectContaining({ startPoint: 'origin/develop' })
        )
      }
    }
  })

  it('reports a repo whose git this host cannot run as a workspace failure, not a fetch failure', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store, {
      fetchBase: vi.fn(async () => {
        throw new SshHostNotServedError('box')
      })
    })
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(result).toMatchObject({ ok: false, error: 'worktree_create_failed' })
    expect(deps.createWorktree).not.toHaveBeenCalled()
    expect(deps.launchAgent).not.toHaveBeenCalled()
  })

  it('branches the primary checkout from HEAD when no base resolves', async () => {
    const deps = serviceDeps(memoryStore(), {
      options: options({ baseRefDefault: async () => null })
    })
    const result = await startTaskFromCard({ ref: ref(7), workspaceMode: 'primary' }, deps)
    expect(result.ok).toBe(true)
    expect(deps.fetchBase).not.toHaveBeenCalled()
    expect(vi.mocked(deps.createPrimaryBranch).mock.calls[0][0]).not.toHaveProperty('startPoint')
    expect(deps.launchAgent).toHaveBeenCalled()
  })

  it('moves a started card to In progress', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store)
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(result.ok).toBe(true)
    expect(deps.moveCard).toHaveBeenCalledExactlyOnceWith(
      ref(7),
      'in-progress',
      expect.any(Function)
    )
    expect(deps.cardMoved).toHaveBeenCalledExactlyOnceWith('github:local:web:7')
    expect(store.getById(result.ok ? result.run.id : '')?.note).toBeUndefined()
  })

  it('answers without waiting on a slow move, which still records its outcome', async () => {
    const store = memoryStore()
    const move = deferred<'skipped'>()
    const deps = serviceDeps(store, { moveCard: vi.fn(() => move.promise), moveWaitMs: 0 })
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(result.ok).toBe(true)
    const runId = result.ok ? result.run.id : ''
    expect(store.getById(runId)?.note).toBeUndefined()
    move.resolve('skipped')
    await vi.waitFor(() => expect(store.getById(runId)?.note).toBe('move-skipped'))
  })

  it('still starts when the card cannot move, marking the run move-skipped', async () => {
    const outcomes = [
      async () => 'skipped' as const,
      async () => {
        throw new Error('Jira is unreachable')
      }
    ]
    for (const moveCard of outcomes) {
      const store = memoryStore()
      const deps = serviceDeps(store, { moveCard: vi.fn(moveCard) })
      const result = await startTaskFromCard({ ref: ref(7) }, deps)
      expect(result).toMatchObject({ ok: true, run: { note: 'move-skipped' } })
      expect(store.getById(result.ok ? result.run.id : '')).toMatchObject({
        state: 'running',
        launch: 'published',
        note: 'move-skipped'
      })
      expect(deps.closeOrchestrator).not.toHaveBeenCalled()
      expect(deps.cardMoved).not.toHaveBeenCalled()
    }
  })

  it('keeps an earlier note when the card cannot move', async () => {
    const store = memoryStore()
    const deps = serviceDeps(store, {
      moveCard: vi.fn(async () => 'skipped' as const),
      launchAgent: vi.fn(async (_params, onSurfacePublished) => {
        const result = launched('not-delivered')
        onSurfacePublished(result)
        return result
      })
    })
    const result = await startTaskFromCard({ ref: ref(7) }, deps)
    expect(store.getById(result.ok ? result.run.id : '')?.note).toBe('prompt-unconfirmed')
  })

  it('moves no card for a failed or cancelled start', async () => {
    const failed = serviceDeps(memoryStore(), {
      launchAgent: vi.fn(async () => {
        throw new Error('agent missing')
      })
    })
    expect(await startTaskFromCard({ ref: ref(7) }, failed)).toMatchObject({ ok: false })
    expect(failed.moveCard).not.toHaveBeenCalled()

    const store = memoryStore()
    const cancelled = serviceDeps(store, {
      launchAgent: vi.fn(async (params, onSurfacePublished) => {
        const result = launched()
        onSurfacePublished(result)
        store.transition(params.operationId ?? '', ['running', 'waiting'], { state: 'stopping' })
        return result
      })
    })
    expect(await startTaskFromCard({ ref: ref(7) }, cancelled)).toMatchObject({
      ok: false,
      error: 'cancelled'
    })
    expect(cancelled.moveCard).not.toHaveBeenCalled()
  })

  it('runs one move per card at a time when a stopped card starts again', async () => {
    const store = memoryStore()
    const first = deferred<'moved'>()
    const moveCard = vi
      .fn<TaskStartServiceDeps['moveCard']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue('kept')
    const deps = serviceDeps(store, { moveCard, moveWaitMs: 0 })
    const started = await startTaskFromCard({ ref: ref(7) }, deps)
    store.transition(started.ok ? started.run.id : '', ['running', 'waiting'], {
      state: 'stopped'
    })
    expect((await startTaskFromCard({ ref: ref(7) }, deps)).ok).toBe(true)
    expect(moveCard).toHaveBeenCalledTimes(1)
    first.resolve('moved')
    await vi.waitFor(() => expect(moveCard).toHaveBeenCalledTimes(2))
  })
})
