import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repository/repo-types'

const listIssues = vi.hoisted(() => vi.fn())
const getWorkItemStatuses = vi.hoisted(() => vi.fn())
vi.mock('../gitlab/issues/gitlab-issue-queries', () => ({ listIssues }))
vi.mock('../gitlab/work-items/work-item-status', () => ({ getWorkItemStatuses }))

import { readGitLabTaskBoardRepos } from './task-board-host-repo-sources'

const deps = { getLocalGitArgs: (): [] => [] }
const repo: Repo = { id: 'app', path: '/src/app', displayName: 'app', badgeColor: '', addedAt: 1 }

function issue(number: number, labels: string[]) {
  return {
    number,
    title: `Issue ${number}`,
    state: 'opened',
    url: `https://git.example.com/acme/app/-/issues/${number}`,
    labels,
    updatedAt: '2026-11-13T00:00:00Z'
  }
}

beforeEach(() => {
  listIssues.mockReset()
  getWorkItemStatuses.mockReset()
  listIssues.mockImplementation(
    async (_path: string, _limit: number, _pref: unknown, state: string) => ({
      items: state === 'opened' ? [issue(7, []), issue(8, ['In progress'])] : [],
      totalPages: 1
    })
  )
})

describe('readGitLabTaskBoardRepos', () => {
  it('reads the listed issues’ Status in one call per project and shows it on the card', async () => {
    getWorkItemStatuses.mockResolvedValue({
      kind: 'statuses',
      statuses: new Map([
        [7, { id: 'gid://status/39', name: 'In review' }],
        [8, null]
      ])
    })

    const result = await readGitLabTaskBoardRepos([repo], { fresh: false }, deps)

    expect(getWorkItemStatuses).toHaveBeenCalledTimes(1)
    expect(getWorkItemStatuses.mock.calls[0].slice(1, 3)).toEqual([
      { host: 'git.example.com', path: 'acme/app' },
      [7, 8]
    ])
    expect(
      result.cards.map((card) => [card.displayId, card.statusName, card.workItemStatus ?? null])
    ).toEqual([
      ['#7', 'In review', { id: 'gid://status/39', name: 'In review' }],
      ['#8', 'opened', null]
    ])
  })

  it('keeps the board ready on labels and state when GitLab cannot answer statuses', async () => {
    getWorkItemStatuses.mockResolvedValue({ kind: 'failed', error: 'timed out' })

    const result = await readGitLabTaskBoardRepos([repo], { fresh: false }, deps)

    expect(result.status).toBe('ready')
    expect(
      result.cards.map((card) => [card.statusName, card.labels, card.workItemStatus ?? null])
    ).toEqual([
      ['opened', [], null],
      ['opened', ['In progress'], null]
    ])
  })
})
