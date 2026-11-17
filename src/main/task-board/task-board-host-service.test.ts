import { expect, it, vi } from 'vitest'
import type { JiraComment, JiraIssue, JiraStatus } from '../../shared/jira/jira-types'
import {
  taskBoardRefKey,
  toJiraTaskBoardCard
} from '../../shared/task-board/task-board-provider-cards'
import { getDefaultTaskBoardSettings } from '../../shared/task-board/task-board-settings'
import { createTaskBoardEnrichCaches } from './task-board-enrich'
import type { TaskBoardListOptions } from './task-board-host-list'
import { createTaskBoardMoveHolds } from './task-board-move-holds'
import type { TaskStartRun } from '../../shared/task-board/task-start-run'
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
  let runs: Record<string, TaskStartRun> = {}
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
        read: () => runs,
        write: (next) => {
          runs = next
        },
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        emit: () => {}
      }),
      hostReachable: unused,
      terminal: {
        ptyIdForHandle: unused,
        paneBinding: unused,
        ptyLiveness: unused,
        agentPresence: unused,
        subscribeExit: unused,
        subscribeAgentExited: unused
      },
      chat: {
        liveness: unused,
        liveSessionId: unused,
        subscribeTabHidden: unused,
        subscribeStatus: unused
      }
    },
    caches: createTaskBoardEnrichCaches(),
    moveHolds: createTaskBoardMoveHolds(),
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
    gitlabWorkItemStatuses: unused,
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

it('lists the task-start run of a card in any column', async () => {
  const { deps } = setup({ ok: true, id: 'c-2' })
  const claimed = deps.taskStart.store.claim({
    cardKey: (await listTaskBoard(deps, { fresh: false })).cards[0].refKey,
    repoId: 'repo-1',
    workspaceMode: 'primary'
  })
  if (!claimed.ok) {
    throw new Error('claim failed')
  }
  // A start alive in this process is not reconciled away.
  deps.taskStart.store.inFlight.add(claimed.run.id)
  deps.taskStart.store.transition(claimed.run.id, ['running'], {
    state: 'waiting',
    phase: 'plan-review',
    orchestrator: {
      hostId: 'local',
      agent: 'claude',
      worktreeId: 'wt-1',
      surface: 'terminal',
      paneKey: 'tab-1:1'
    }
  })

  const [card] = (await listTaskBoard(deps, { fresh: false })).cards

  expect(card.taskStart).toMatchObject({
    state: 'waiting',
    percent: 20,
    orchestrator: { paneKey: 'tab-1:1' }
  })
})

it('holds a moved card in its new column until the provider list agrees or the hold expires', async () => {
  let now = 0
  const { deps } = setup({ ok: true, id: 'c-2' })
  deps.moveHolds = createTaskBoardMoveHolds(() => now)
  const toDo: JiraStatus = { id: '1', name: 'To Do', categoryKey: 'new', categoryName: 'To Do' }
  let status = toDo
  const jira = vi.fn(async (_options: TaskBoardListOptions) => ({
    provider: 'jira' as const,
    status: 'ready' as const,
    cards: [toJiraTaskBoardCard({ ...jiraIssue, status })]
  }))
  deps.host = { ...deps.host, sources: { ...deps.host.sources, jira } }
  const column = async () => (await listTaskBoard(deps, { fresh: false })).cards[0].columnId
  const key = taskBoardRefKey(ref, null)

  deps.moveHolds.hold(key, 'todo', 'in-progress')
  expect(await column()).toBe('in-progress')
  status = jiraIssue.status
  expect(await column()).toBe('in-progress')
  // The list agreed, so the hold is gone: a later move back shows as the provider lists it.
  status = toDo
  expect(await column()).toBe('todo')

  deps.moveHolds.hold(key, 'todo', 'in-progress')
  now += 120_001
  expect(await column()).toBe('todo')
  expect(jira.mock.calls.every(([options]) => options.fresh === false)).toBe(true)
})
