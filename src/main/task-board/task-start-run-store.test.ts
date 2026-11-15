import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setSecretStore } from '../../shared/secret-store'
import type { TaskStartRun } from '../../shared/task-board/task-start-run'
import { Store } from '../persistence/loading-store/store'
import { createSqliteTestStore } from '../persistence/persistence-test-harness'
import {
  createTaskStartRunStore,
  type TaskStartRunStoreDeps,
  type TaskStartRunsChangedEvent
} from './task-start-run-store'

function memoryDeps(events: TaskStartRunsChangedEvent[] = []): TaskStartRunStoreDeps {
  let runs: Record<string, TaskStartRun> = {}
  return {
    read: () => runs,
    write: (next) => {
      runs = next
    },
    now: () => new Date('2026-11-15T10:00:00.000Z'),
    emit: (event) => events.push(event)
  }
}

describe('task start run store', () => {
  it('refuses a second exclusive run on the same card', () => {
    const store = createTaskStartRunStore(memoryDeps())
    expect(
      store.claim({ cardKey: 'jira:a:APP-1', repoId: 'r', workspaceMode: 'worktree' }).ok
    ).toBe(true)
    expect(
      store.claim({ cardKey: 'jira:a:APP-1', repoId: 'r', workspaceMode: 'worktree' })
    ).toEqual({
      ok: false,
      reason: 'already_running'
    })
  })

  it('refuses two cards sharing a primary workspace', () => {
    const store = createTaskStartRunStore(memoryDeps())
    const claim = (cardKey: string) =>
      store.claim({ cardKey, repoId: 'r', workspaceMode: 'primary', primaryKey: 'r' })
    expect(claim('c1').ok).toBe(true)
    expect(claim('c2')).toEqual({ ok: false, reason: 'primary_busy' })
  })

  it('does not apply a transition whose expected states exclude the current one', () => {
    const events: TaskStartRunsChangedEvent[] = []
    const store = createTaskStartRunStore(memoryDeps(events))
    const claimed = store.claim({ cardKey: 'c1', repoId: 'r', workspaceMode: 'worktree' })
    if (!claimed.ok) {
      throw new Error('claim failed')
    }
    store.transition(claimed.run.id, ['running'], { state: 'stopping' })
    events.length = 0
    expect(store.transition(claimed.run.id, ['running'], { state: 'stopped' })).toBeNull()
    expect(store.getById(claimed.run.id)?.state).toBe('stopping')
    expect(events).toEqual([])
  })

  it('announces a run that starts waiting with its workspace and title', () => {
    const events: TaskStartRunsChangedEvent[] = []
    const store = createTaskStartRunStore(memoryDeps(events))
    const claimed = store.claim({ cardKey: 'c1', repoId: 'r', workspaceMode: 'worktree' })
    if (!claimed.ok) {
      throw new Error('claim failed')
    }
    store.transition(claimed.run.id, ['running'], {
      state: 'waiting',
      worktreeId: 'wt-1',
      title: 'Fix login'
    })
    expect(events.at(-1)).toEqual({
      type: 'taskBoardRunsChanged',
      cardKeys: ['c1'],
      waiting: [{ cardKey: 'c1', worktreeId: 'wt-1', title: 'Fix login' }]
    })
  })

  it('finds a published exclusive run by orchestrator but not a pending launch', () => {
    const deps = memoryDeps()
    const store = createTaskStartRunStore(deps)
    const pending = store.claim({ cardKey: 'c1', repoId: 'r', workspaceMode: 'worktree' })
    if (!pending.ok) {
      throw new Error('claim failed')
    }
    const orchestrator = {
      hostId: 'h',
      agent: 'claude' as const,
      worktreeId: 'w',
      surface: 'terminal' as const,
      handle: 'term_1'
    }
    store.transition(pending.run.id, ['running'], { orchestrator })
    expect(store.findByOrchestrator({ handle: 'term_1' })).toBeNull()

    deps.write({
      ...deps.read(),
      [pending.run.id]: { ...pending.run, orchestrator, launch: 'published' }
    })
    expect(store.findByOrchestrator({ handle: 'term_1' })?.id).toBe(pending.run.id)
  })

  it('keeps a persisted run across a store reload', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-task-start-runs-'))
    setSecretStore({
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`sealed:${value}`),
      decryptString: (value) => value.toString().slice('sealed:'.length),
      describeProtectionGap: () => null
    })
    const dataFile = join(directory, 'state.json')
    let sqlite = createSqliteTestStore(Store, { dataFile })
    try {
      const store = createTaskStartRunStore({
        read: () => sqlite.getUI().taskStartRuns ?? {},
        write: (next) => sqlite.updateUI({ taskStartRuns: next }),
        now: () => new Date('2026-11-15T10:00:00.000Z'),
        emit: () => {}
      })
      const claimed = store.claim({ cardKey: 'c1', repoId: 'r', workspaceMode: 'worktree' })
      if (!claimed.ok) {
        throw new Error('claim failed')
      }
      store.transition(claimed.run.id, ['running'], { launch: 'published', state: 'waiting' })
      sqlite.flush()
      await sqlite.freezeWritesAsync()
      sqlite = createSqliteTestStore(Store, { dataFile })
      expect(sqlite.getUI().taskStartRuns?.[claimed.run.id]).toMatchObject({
        cardKey: 'c1',
        state: 'waiting',
        launch: 'published'
      })
    } finally {
      await sqlite.freezeWritesAsync()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
