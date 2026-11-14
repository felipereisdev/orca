import { describe, expect, it } from 'vitest'
import type { JiraComment, JiraIssue } from '../../shared/jira/jira-types'
import { toJiraTaskBoardCard } from '../../shared/task-board/task-board-provider-cards'
import { taskBoardProject } from '../../shared/task-board/task-board-project-filter'
import type { TaskBoardWireCard } from '../../shared/task-board/task-board-wire-types'
import {
  createTaskBoardEnrichCaches,
  enrichTaskBoardCards,
  type TaskBoardEnrichContext,
  type TaskBoardEnrichDeps
} from './task-board-enrich'
import { taskBoardCardRef } from './task-board-host-list'

const now = new Date('2026-11-14T12:00:00.000Z')
const unexpected = () => Promise.reject(new Error('not this provider'))

function card(key: string, columnId: string): TaskBoardWireCard {
  const issue: JiraIssue = {
    id: key,
    key,
    siteId: 'site-a',
    title: key,
    url: `https://a.atlassian.net/browse/${key}`,
    project: { id: '1', key: 'APP', name: 'App' },
    issueType: { id: '1', name: 'Task' },
    status: { id: '3', name: 'Doing', categoryKey: 'indeterminate', categoryName: 'In Progress' },
    labels: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-13T00:00:00Z'
  }
  const base = toJiraTaskBoardCard(issue, false)
  return {
    ...base,
    ref: taskBoardCardRef(base),
    columnId,
    project: taskBoardProject(base),
    moveTargets: []
  }
}

function comment(id: string, at: string, accountId = 'someone'): JiraComment {
  return { id, body: `Comment ${id}`, createdAt: at, user: { accountId, displayName: accountId } }
}

function enrichDeps(jiraComments: TaskBoardEnrichDeps['jiraComments']): TaskBoardEnrichDeps {
  return {
    repo: () => null,
    getLocalGitArgs: () => [],
    jiraSites: () => [{ id: 'site-a', accountId: 'me' }],
    jiraComments,
    linearComments: unexpected,
    linearViewerId: unexpected,
    gitlabWorkItemDetails: unexpected,
    githubWorkItemDetails: unexpected,
    commitsAhead: async () => null,
    hostedReview: async () => null,
    workspaces: async () => [],
    // A frozen clock keeps every entry inside its TTL.
    caches: createTaskBoardEnrichCaches(() => 0)
  }
}

function context(
  deps: TaskBoardEnrichDeps,
  overrides: Partial<TaskBoardEnrichContext> = {}
): TaskBoardEnrichContext {
  return {
    todoColumnId: 'todo',
    doneColumnId: 'completed',
    fresh: false,
    seen: {},
    now,
    deps,
    ...overrides
  }
}

describe('enrichTaskBoardCards', () => {
  it('keeps a card whose comments fail, marked unavailable, and enriches the rest', async () => {
    const todo = card('APP-3', 'todo')
    const deps = enrichDeps(async (key) => {
      if (key === 'APP-1') {
        throw new Error('Jira timed out')
      }
      return [comment('c1', '2026-11-14T11:00:00.000Z')]
    })

    const cards = await enrichTaskBoardCards(
      [card('APP-1', 'in-progress'), card('APP-2', 'in-review'), todo],
      context(deps)
    )

    expect(cards.map(({ displayId, enrichment }) => ({ displayId, enrichment }))).toEqual([
      { displayId: 'APP-1', enrichment: 'unavailable' },
      { displayId: 'APP-2', enrichment: 'ok' },
      { displayId: 'APP-3', enrichment: undefined }
    ])
    expect(cards[1]).toMatchObject({
      progress: null,
      latestComment: { author: 'someone', at: '2026-11-14T11:00:00.000Z', excerpt: 'Comment c1' },
      unreadComments: 1
    })
    expect(cards[2]).toEqual(todo)
  })

  it('reuses cached comments but counts unread from the current marker until a fresh read', async () => {
    let comments = [
      comment('c1', '2026-11-14T10:00:00.000Z'),
      comment('c2', '2026-11-14T11:00:00.000Z'),
      comment('mine', '2026-11-14T11:30:00.000Z', 'me')
    ]
    const deps = enrichDeps(async () => comments)
    const inProgress = [card('APP-1', 'in-progress')]
    const refKey = inProgress[0].refKey

    const first = await enrichTaskBoardCards(inProgress, context(deps))
    comments = [...comments, comment('c3', '2026-11-14T11:45:00.000Z')]
    const cached = await enrichTaskBoardCards(
      inProgress,
      context(deps, { seen: { [refKey]: { at: '2026-11-14T10:00:00.000Z', ids: ['c1'] } } })
    )
    const fresh = await enrichTaskBoardCards(
      inProgress,
      context(deps, {
        fresh: true,
        seen: { [refKey]: { at: '2026-11-14T10:00:00.000Z', ids: ['c1'] } }
      })
    )

    expect(
      [first, cached, fresh].map(([read]) => [read.unreadComments, read.latestComment?.at])
    ).toEqual([
      [2, '2026-11-14T11:30:00.000Z'],
      [1, '2026-11-14T11:30:00.000Z'],
      [2, '2026-11-14T11:45:00.000Z']
    ])
  })
})
