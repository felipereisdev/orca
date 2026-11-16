import { describe, expect, it, vi } from 'vitest'
import type { GitLabWorkItem } from '../../shared/gitlab/gitlab-types'
import type { JiraIssue } from '../../shared/jira/jira-types'
import type { Repo } from '../../shared/repository/repo-types'
import {
  toGitLabTaskBoardCard,
  toJiraTaskBoardCard
} from '../../shared/task-board/task-board-provider-cards'
import type { TaskBoardProviderResult } from '../../shared/task-board/task-board-provider-results'
import { getDefaultTaskBoardSettings } from '../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../shared/work-items/task-providers'
import { buildTaskBoardList, type TaskBoardHostDeps } from './task-board-host-list'

const columns = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
]

const jiraIssue: JiraIssue = {
  id: '10',
  key: 'APP-1',
  siteId: 'site-a',
  title: 'Fix login',
  url: 'https://a.atlassian.net/browse/APP-1',
  project: { id: '1', key: 'APP', name: 'App' },
  issueType: { id: '1', name: 'Task' },
  status: {
    id: '3',
    name: 'In Progress',
    categoryKey: 'indeterminate',
    categoryName: 'In Progress'
  },
  labels: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-13T00:00:00Z'
}

const gitLabIssue: GitLabWorkItem = {
  id: 'gitlab-issue-app-7',
  type: 'issue',
  number: 7,
  title: 'Add export',
  state: 'opened',
  url: 'https://gitlab.com/acme/app/-/issues/7',
  labels: [],
  updatedAt: '2026-11-12T00:00:00Z',
  author: null,
  repoId: 'app',
  repoHostId: 'local',
  projectRef: { host: 'gitlab.com', path: 'acme/app' }
}

const localRepo: Repo = {
  id: 'app',
  path: '/src/app',
  displayName: 'app',
  badgeColor: '',
  addedAt: 1
}

function ready(provider: TaskProvider, cards: TaskBoardProviderResult['cards']) {
  return async (): Promise<TaskBoardProviderResult> => ({ provider, status: 'ready', cards })
}

function deps(overrides: Partial<TaskBoardHostDeps> = {}): TaskBoardHostDeps {
  return {
    repos: () => [localRepo],
    settings: () => ({
      taskBoard: getDefaultTaskBoardSettings(),
      visibleTaskProviders: ['github', 'gitlab', 'linear', 'jira']
    }),
    statuses: () => columns,
    preflight: async () => ({
      git: { installed: true },
      gh: { installed: true, authenticated: true },
      glab: { installed: true, authenticated: true }
    }),
    isSshHost: false,
    sources: {
      jira: ready('jira', [toJiraTaskBoardCard(jiraIssue)]),
      linear: ready('linear', []),
      gitlab: ready('gitlab', [toGitLabTaskBoardCard(gitLabIssue, 'app')]),
      github: ready('github', [])
    },
    ...overrides
  }
}

describe('buildTaskBoardList', () => {
  it('keeps the other providers when one provider read fails', async () => {
    const base = deps()
    const result = await buildTaskBoardList(
      {
        ...base,
        sources: {
          ...base.sources,
          gitlab: async () => ({
            provider: 'gitlab',
            status: 'error',
            cards: [],
            error: { code: 'unavailable', message: 'glab: connection refused' }
          })
        }
      },
      { fresh: false }
    )

    expect(result.cards.map((card) => card.displayId)).toEqual(['APP-1'])
    expect(result.cards[0].columnId).toBe('in-progress')
    expect(result.providers.gitlab).toEqual({
      status: 'error',
      error: { code: 'unavailable', message: 'glab: connection refused' }
    })
    expect(result.providers.jira).toEqual({ status: 'ready' })
  })

  it('blocks moving a GitLab card to a column no label rule maps', async () => {
    const result = await buildTaskBoardList(deps(), { fresh: false })
    const card = result.cards.find((c) => c.provider === 'gitlab')

    expect(card?.columnId).toBe('todo')
    expect(card?.ref).toEqual({
      provider: 'gitlab',
      repoId: 'app',
      number: 7,
      projectRef: { host: 'gitlab.com', path: 'acme/app' }
    })
    expect(card?.moveTargets).toEqual([
      { columnId: 'in-progress', allowed: false, reason: 'no-mapping' },
      { columnId: 'in-review', allowed: false, reason: 'no-mapping' },
      { columnId: 'completed', allowed: true }
    ])
  })

  it('reports a hidden provider as disconnected without reading it', async () => {
    const linear = vi.fn(ready('linear', []))
    const base = deps()
    const result = await buildTaskBoardList(
      {
        ...base,
        settings: () => ({
          taskBoard: getDefaultTaskBoardSettings(),
          visibleTaskProviders: ['github', 'gitlab', 'jira']
        }),
        sources: { ...base.sources, linear }
      },
      { fresh: false }
    )

    expect(result.providers.linear).toEqual({ status: 'disconnected' })
    expect(linear).not.toHaveBeenCalled()
  })
})
