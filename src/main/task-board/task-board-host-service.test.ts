import { expect, it } from 'vitest'
import type { JiraComment, JiraIssue } from '../../shared/jira/jira-types'
import { toJiraTaskBoardCard } from '../../shared/task-board/task-board-provider-cards'
import { getDefaultTaskBoardSettings } from '../../shared/task-board/task-board-settings'
import { createTaskBoardEnrichCaches } from './task-board-enrich'
import { createTaskStartRunStore } from './task-start-run-store'
import {
  addTaskBoardComment,
  listTaskBoard,
  type TaskBoardServiceDeps
} from './task-board-host-service'

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
const ref = { provider: 'jira' as const, siteId: 'site-a', key: 'APP-1' }

function comment(id: string, body: string, createdAt: string): JiraComment {
  return {
    id,
    body,
    createdAt,
    user: { accountId: 'ada', displayName: 'Ada' }
  }
}

function unused(): never {
  throw new Error('not read in this scenario')
}

function setup(writeResult: { ok: true; id: string } | { ok: false; error: string }) {
  const upstream = [comment('c-1', 'First look', '2026-11-13T09:00:00Z')]
  const deps: TaskBoardServiceDeps = {
    host: {
      repos: () => [],
      settings: () => ({
        taskBoard: getDefaultTaskBoardSettings(),
        visibleTaskProviders: ['jira']
      }),
      statuses: () => [
        { id: 'todo', label: 'Todo' },
        { id: 'in-progress', label: 'In progress' },
        { id: 'completed', label: 'Done' }
      ],
      preflight: async () => null,
      isSshHost: false,
      sources: {
        jira: async () => ({
          provider: 'jira',
          status: 'ready',
          cards: [toJiraTaskBoardCard(jiraIssue)]
        }),
        linear: unused,
        gitlab: unused,
        github: unused
      }
    },
    taskStart: {
      store: createTaskStartRunStore({
        read: () => ({}),
        write: unused,
        now: () => new Date(),
        emit: unused
      }),
      hostReachable: unused,
      terminal: {
        show: unused,
        handleForPaneKey: unused,
        liveness: unused,
        waitForExit: unused
      },
      chat: { liveness: unused, subscribeStatus: unused }
    },
    caches: createTaskBoardEnrichCaches(),
    workspaces: async () => [],
    commitsAhead: unused,
    hostedReview: unused,
    repo: () => null,
    getLocalGitArgs: () => [],
    jiraSites: () => [{ id: 'site-a', accountId: 'me' }],
    jiraSiteCount: () => 1,
    jiraComments: async () => [...upstream],
    jiraIssue: unused,
    linearComments: unused,
    linearViewerId: unused,
    linearIssue: unused,
    gitlabWorkItemDetails: unused,
    githubWorkItemDetails: unused,
    addJiraComment: async () => {
      if (writeResult.ok) {
        upstream.push(comment('c-2', 'Shipped behind a flag', '2026-11-14T09:00:00Z'))
      }
      return writeResult
    },
    addLinearComment: unused,
    addGitLabComment: unused,
    addGitHubComment: unused,
    readSeen: () => ({}),
    writeSeen: unused
  }
  const latest = async () =>
    (await listTaskBoard(deps, { fresh: false })).cards[0].latestComment?.excerpt
  return { deps, latest }
}

it('shows a confirmed comment on the next cached listing', async () => {
  const { deps, latest } = setup({ ok: true, id: 'c-2' })
  expect(await latest()).toBe('First look')
  expect(await addTaskBoardComment(deps, ref, 'Shipped behind a flag')).toEqual({
    status: 'added',
    commentId: 'c-2'
  })
  expect(await latest()).toBe('Shipped behind a flag')
})

it('reports an unconfirmed provider write as failed', async () => {
  const { deps } = setup({
    ok: false,
    error: 'Jira did not confirm the comment. Verify in Jira before retrying.'
  })
  expect(await addTaskBoardComment(deps, ref, 'Shipped behind a flag')).toEqual({
    status: 'failed',
    error: 'Jira did not confirm the comment. Verify in Jira before retrying.'
  })
})
