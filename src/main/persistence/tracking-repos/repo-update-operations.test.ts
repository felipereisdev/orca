import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repository/repo-types'
import { RepoUpdatePersistenceOperations } from './repo-update-operations'

function makeOperations(repo: Repo) {
  const state = { repos: [repo], projectGroups: [], worktreeMeta: {} }
  const operations = new RepoUpdatePersistenceOperations({
    state,
    bumpLocalWorktreeScanGeneration: vi.fn(),
    syncProjectHostSetupCompatibilityState: vi.fn(),
    scheduleSave: vi.fn(),
    hydrateRepo: (r) => r
  })
  return { operations, state }
}

describe('updateRepo taskStart', () => {
  it('persists normalized task-start settings and clears them on null', () => {
    const { operations, state } = makeOperations({
      id: 'repo-1',
      path: '/repos/example',
      displayName: 'Example',
      badgeColor: '#000000',
      addedAt: 0,
      kind: 'git'
    })

    operations.updateRepo(
      { id: 'repo-1' },
      {
        taskStart: { workspaceMode: 'primary', roles: { qa: { agent: 'codex', effort: 'high' } } }
      }
    )
    expect(state.repos[0].taskStart).toEqual({
      workspaceMode: 'primary',
      roles: { qa: { agent: 'codex' } }
    })

    operations.updateRepo({ id: 'repo-1' }, { taskStart: null })
    expect('taskStart' in state.repos[0]).toBe(false)
  })

  it('keeps an existing override when the update normalizes to nothing', () => {
    const { operations, state } = makeOperations({
      id: 'repo-1',
      path: '/repos/example',
      displayName: 'Example',
      badgeColor: '#000000',
      addedAt: 0,
      kind: 'git',
      taskStart: { workspaceMode: 'primary' }
    })

    // Why: the RPC schema turns invalid input into an explicit undefined key.
    operations.updateRepo({ id: 'repo-1' }, { taskStart: undefined })
    operations.updateRepo({ id: 'repo-1' }, { taskStart: {} })
    // @ts-expect-error -- untyped RPC input can carry a non-object taskStart
    operations.updateRepo({ id: 'repo-1' }, { taskStart: 'x' })

    expect(state.repos[0].taskStart).toEqual({ workspaceMode: 'primary' })
  })
})

describe('updateRepo defaultLinearProject', () => {
  it('persists a normalized project and clears it on null', () => {
    const { operations, state } = makeOperations({
      id: 'repo-1',
      path: '/repos/example',
      displayName: 'Example',
      badgeColor: '#000000',
      addedAt: 0,
      kind: 'git'
    })

    operations.updateRepo(
      { id: 'repo-1' },
      {
        defaultLinearProject: {
          id: ' proj-1 ',
          name: ' App ',
          workspaceId: ' ws-1 ',
          // @ts-expect-error -- untyped RPC input can carry extra project fields
          url: 'https://linear.app/x'
        }
      }
    )
    expect(state.repos[0].defaultLinearProject).toEqual({
      id: 'proj-1',
      name: 'App',
      workspaceId: 'ws-1'
    })

    operations.updateRepo({ id: 'repo-1' }, { defaultLinearProject: null })
    expect(state.repos[0].defaultLinearProject ?? null).toBeNull()
  })
})
