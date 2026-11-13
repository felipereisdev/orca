import { describe, expect, it } from 'vitest'
import {
  getDefaultTaskBoardSettings,
  type TaskBoardRule,
  type TaskBoardSettings
} from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import { jiraStatusCategory, linearStatusCategory } from './task-board-card'
import { resolveTaskBoardColumnId } from './task-board-columns'

const columns = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
]

function settingsWith(provider: TaskProvider, rules: TaskBoardRule[]): TaskBoardSettings {
  const settings = getDefaultTaskBoardSettings()
  settings.providers[provider].rules = rules
  return settings
}

describe('resolveTaskBoardColumnId', () => {
  const defaults = getDefaultTaskBoardSettings()

  it('maps Jira status categories to default columns', () => {
    const resolve = (key: string): string | null =>
      resolveTaskBoardColumnId(
        { provider: 'jira', statusName: 'X', category: jiraStatusCategory(key), labels: [] },
        columns,
        defaults
      )
    expect(resolve('new')).toBe('todo')
    expect(resolve('indeterminate')).toBe('in-progress')
    expect(resolve('done')).toBe('completed')
  })

  it('matches Jira status names ignoring case and surrounding whitespace', () => {
    const settings = settingsWith('jira', [{ match: 'Em Homologação ', statusId: 'in-review' }])
    expect(
      resolveTaskBoardColumnId(
        { provider: 'jira', statusName: 'em homologação', category: 'in-progress', labels: [] },
        columns,
        settings
      )
    ).toBe('in-review')
  })

  it('excludes canceled Linear issues', () => {
    expect(
      resolveTaskBoardColumnId(
        {
          provider: 'linear',
          statusName: 'Canceled',
          category: linearStatusCategory('canceled'),
          labels: []
        },
        columns,
        defaults
      )
    ).toBeNull()
  })

  it('ignores labels on closed GitLab issues', () => {
    const settings = settingsWith('gitlab', [{ match: 'workflow::doing', statusId: 'in-progress' }])
    expect(
      resolveTaskBoardColumnId(
        { provider: 'gitlab', statusName: 'closed', category: 'done', labels: ['workflow::doing'] },
        columns,
        settings
      )
    ).toBe('completed')
  })

  it('lets the first rule in rule order win among matching labels', () => {
    const settings = settingsWith('gitlab', [
      { match: 'workflow::review', statusId: 'in-review' },
      { match: 'workflow::doing', statusId: 'in-progress' }
    ])
    const resolve = (labels: string[]): string | null =>
      resolveTaskBoardColumnId(
        { provider: 'gitlab', statusName: 'opened', category: 'todo', labels },
        columns,
        settings
      )
    expect(resolve(['a', 'workflow::doing'])).toBe('in-progress')
    expect(resolve(['a', 'workflow::doing', 'workflow::review'])).toBe('in-review')
  })

  it('falls back to first and last columns when todo and done ids are absent', () => {
    const custom = [
      { id: 'backlog', label: 'Backlog' },
      { id: 'shipping', label: 'Shipping' }
    ]
    const resolve = (category: 'todo' | 'done'): string | null =>
      resolveTaskBoardColumnId(
        { provider: 'github', statusName: '', category, labels: [] },
        custom,
        defaults
      )
    expect(resolve('todo')).toBe('backlog')
    expect(resolve('done')).toBe('shipping')
  })

  it('ignores rules that point to a missing column', () => {
    const settings = settingsWith('jira', [{ match: 'QA', statusId: 'gone' }])
    expect(
      resolveTaskBoardColumnId(
        { provider: 'jira', statusName: 'QA', category: 'in-progress', labels: [] },
        columns,
        settings
      )
    ).toBe('in-progress')
  })
})
