import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../../../shared/repo-types'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

import { getTaskBoardRepos, type TaskBoardScopeInput } from './task-board-provider-scope'

const localRepo: Repo = {
  id: 'local-repo',
  path: '/Users/me/app',
  displayName: 'app',
  badgeColor: '',
  addedAt: 1
}

function scope(glab: { installed: boolean; authenticated: boolean }): TaskBoardScopeInput {
  return {
    repos: [localRepo],
    preflightStatus: {
      git: { installed: true },
      gh: { installed: true, authenticated: true },
      glab
    },
    preflightStatusChecked: true,
    visibleTaskProviders: ['gitlab']
  }
}

describe('getTaskBoardRepos', () => {
  it('keeps repos when the provider CLI is installed but its auth probe fails', () => {
    expect(
      getTaskBoardRepos('gitlab', scope({ installed: true, authenticated: false })).map(
        (repo) => repo.id
      )
    ).toEqual(['local-repo'])
  })

  it('skips repos when the provider CLI is not installed', () => {
    expect(getTaskBoardRepos('gitlab', scope({ installed: false, authenticated: false }))).toEqual(
      []
    )
  })
})
