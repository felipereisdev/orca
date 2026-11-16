import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_WORK_ITEMS_SSH_REMOTE_REQUIRED_MESSAGE } from '../../shared/github/work-items/work-item-ssh-error'
import type { Repo } from '../../shared/repository/repo-types'

const listWorkItems = vi.hoisted(() => vi.fn())
vi.mock('../github/client/list/list-work-items', () => ({ listWorkItems }))

import { readGitHubTaskBoardRepos } from './task-board-host-github-source'

const deps = { getLocalGitArgs: (): [] => [] }
const sources = { issues: { owner: 'acme', repo: 'app' }, prs: null }

function repo(id: string, executionHostId: Repo['executionHostId']): Repo {
  return { id, path: `/src/${id}`, displayName: id, badgeColor: '', addedAt: 1, executionHostId }
}

beforeEach(() => {
  listWorkItems.mockReset()
})

describe('readGitHubTaskBoardRepos', () => {
  it('skips an SSH repo without a GitHub remote instead of failing the provider', async () => {
    listWorkItems.mockRejectedValue(new Error(GITHUB_WORK_ITEMS_SSH_REMOTE_REQUIRED_MESSAGE))

    const result = await readGitHubTaskBoardRepos(
      [repo('box-app', 'ssh:box')],
      { fresh: false },
      deps
    )

    expect(result).toEqual({ provider: 'github', status: 'ready', cards: [] })
  })

  it('keeps open issues when the closed read fails, reporting the failure', async () => {
    listWorkItems.mockImplementation(async (_path: string, _limit: number, query: string) =>
      query.includes('is:open')
        ? {
            sources,
            items: [
              {
                id: 'issue-4',
                type: 'issue',
                number: 4,
                title: 'Open one',
                state: 'open',
                url: 'https://github.com/acme/app/issues/4',
                labels: [],
                updatedAt: '2026-11-13T00:00:00Z',
                author: null
              }
            ]
          }
        : {
            sources,
            items: [],
            errors: { issues: { type: 'network_error', message: 'Network error' } }
          }
    )

    const result = await readGitHubTaskBoardRepos([repo('app', null)], { fresh: false }, deps)

    expect(result.cards.map((card) => card.displayId)).toEqual(['#4'])
    expect(result.status).toBe('error')
    expect(result.error).toEqual({ code: 'unavailable', message: 'Network error' })
  })
})
