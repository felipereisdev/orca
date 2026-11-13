import { describe, expect, it } from 'vitest'
import {
  getDefaultTaskBoardSettings,
  type TaskBoardSettings
} from '../../../../../shared/task-board/task-board-settings'
import type { JiraTransition } from '../../../../../shared/jira/jira-types'
import type { LinearWorkflowState } from '../../../../../shared/linear/workspace-types'
import type { TaskBoardCard } from './task-board-card'
import {
  resolveLabelProviderMove,
  selectJiraMoveTransitions,
  selectLinearMoveStates
} from './task-board-move-targets'

const columns = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
]

function githubCard(category: 'todo' | 'done', labels: string[]): TaskBoardCard {
  return {
    refKey: 'github:repo:1',
    provider: 'github',
    displayId: '#1',
    title: 't',
    url: 'u',
    projectLabel: 'r',
    statusName: category === 'done' ? 'closed' : 'open',
    category,
    labels,
    updatedAt: '2026-01-01T00:00:00Z',
    source: {
      provider: 'github',
      item: {
        id: 'github:repo:1',
        type: 'issue',
        number: 1,
        title: 't',
        state: category === 'done' ? 'closed' : 'open',
        url: 'u',
        labels,
        updatedAt: '2026-01-01T00:00:00Z',
        author: null,
        repoId: 'repo'
      }
    }
  }
}

function transition(name: string, categoryKey: string): JiraTransition {
  return { id: name, name, to: { id: name, name, categoryKey, categoryName: categoryKey } }
}

function linearState(name: string, type: string): LinearWorkflowState {
  return { id: name, name, type, color: '#000', position: 0 }
}

describe('resolveLabelProviderMove', () => {
  const defaults = getDefaultTaskBoardSettings()
  const withRules = (): TaskBoardSettings => {
    const settings = getDefaultTaskBoardSettings()
    settings.providers.github.rules = [
      { match: 'workflow::review', statusId: 'in-review' },
      { match: 'workflow::doing', statusId: 'in-progress' }
    ]
    return settings
  }

  it('reports no-mapping when the target has no rule', () => {
    expect(
      resolveLabelProviderMove(githubCard('todo', []), 'in-review', columns, defaults)
    ).toEqual({ ok: false, reason: 'no-mapping' })
  })

  it('closes the issue when dropped on the done column', () => {
    expect(
      resolveLabelProviderMove(githubCard('todo', []), 'completed', columns, defaults)
    ).toEqual({ ok: true, state: 'closed', addLabels: [], removeLabels: [] })
  })

  it('swaps the label of the current column for the target column label', () => {
    expect(
      resolveLabelProviderMove(
        githubCard('todo', ['workflow::doing']),
        'in-review',
        columns,
        withRules()
      )
    ).toEqual({ ok: true, addLabels: ['workflow::review'], removeLabels: ['workflow::doing'] })
  })

  it('reopens a closed issue dropped on todo', () => {
    expect(
      resolveLabelProviderMove(githubCard('done', []), 'todo', columns, defaults)
    ).toMatchObject({ ok: true, state: 'open' })
  })

  it('reports same-column when the card is already there', () => {
    expect(
      resolveLabelProviderMove(
        githubCard('todo', ['workflow::doing']),
        'in-progress',
        columns,
        withRules()
      )
    ).toEqual({ ok: false, reason: 'same-column' })
  })
})

describe('selectJiraMoveTransitions', () => {
  const transitions = [
    transition('In Progress', 'indeterminate'),
    transition('Code Review', 'indeterminate')
  ]

  it('keeps every transition resolving to the target column', () => {
    const result = selectJiraMoveTransitions(
      transitions,
      'in-progress',
      columns,
      getDefaultTaskBoardSettings()
    )
    expect(result.map((entry) => entry.name)).toEqual(['In Progress', 'Code Review'])
  })

  it('narrows to the configured drop target', () => {
    const settings = getDefaultTaskBoardSettings()
    settings.providers.jira.dropTargets = { 'in-progress': 'code review' }
    const result = selectJiraMoveTransitions(transitions, 'in-progress', columns, settings)
    expect(result.map((entry) => entry.name)).toEqual(['Code Review'])
  })

  it('returns nothing for a column without a mapping', () => {
    expect(
      selectJiraMoveTransitions(transitions, 'in-review', columns, getDefaultTaskBoardSettings())
    ).toEqual([])
  })
})

describe('selectLinearMoveStates', () => {
  it('never offers canceled states', () => {
    const states = [
      linearState('Todo', 'unstarted'),
      linearState('Canceled', 'canceled'),
      linearState('Done', 'completed')
    ]
    const result = selectLinearMoveStates(
      states,
      'completed',
      columns,
      getDefaultTaskBoardSettings()
    )
    expect(result.map((entry) => entry.name)).toEqual(['Done'])
  })
})
