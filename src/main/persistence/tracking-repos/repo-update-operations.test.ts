import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
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
})
