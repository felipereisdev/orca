import { describe, expect, it } from 'vitest'
import type { TaskBoardCard } from './task-board-card'
import {
  listTaskBoardProjects,
  matchesTaskBoardProjects,
  type TaskBoardProject
} from './task-board-project-filter'

function jiraCard(key: string, siteId: string, projectKey: string): TaskBoardCard {
  return {
    refKey: `jira:${siteId}:${key}`,
    provider: 'jira',
    displayId: key,
    title: 't',
    url: 'u',
    projectLabel: projectKey,
    statusName: 'To Do',
    category: 'todo',
    labels: [],
    updatedAt: '2026-11-01T00:00:00Z',
    source: {
      provider: 'jira',
      item: {
        id: key,
        key,
        siteId,
        title: 't',
        url: 'u',
        project: { id: projectKey, key: projectKey, name: projectKey },
        issueType: { id: 'task', name: 'Task' },
        status: { id: '1', name: 'To Do', categoryKey: 'new', categoryName: 'To Do' },
        labels: [],
        updatedAt: '2026-11-01T00:00:00Z',
        createdAt: '2026-11-01T00:00:00Z'
      }
    }
  }
}

const fe: TaskBoardProject = { key: 'jira:a:FE', provider: 'jira', label: 'FE' }

describe('listTaskBoardProjects', () => {
  it('keeps the same project key on two Jira sites as two projects', () => {
    const options = listTaskBoardProjects(
      [jiraCard('SGP2-1', 'a', 'SGP2'), jiraCard('SGP2-2', 'b', 'SGP2')],
      new Map()
    )
    expect(options.map(({ key, count }) => [key, count])).toEqual([
      ['jira:a:SGP2', 1],
      ['jira:b:SGP2', 1]
    ])
  })

  it('keeps a selected project with no cards listed with zero', () => {
    const options = listTaskBoardProjects(
      [jiraCard('SGP2-1', 'a', 'SGP2')],
      new Map([[fe.key, fe]])
    )
    expect(options.find((option) => option.key === fe.key)).toEqual({
      ...fe,
      count: 0,
      selected: true
    })
  })
})

describe('matchesTaskBoardProjects', () => {
  it('shows every card without a selection and only selected projects otherwise', () => {
    const card = jiraCard('SGP2-1', 'a', 'SGP2')
    expect(matchesTaskBoardProjects(card, new Map())).toBe(true)
    expect(matchesTaskBoardProjects(card, new Map([[fe.key, fe]]))).toBe(false)
  })
})
