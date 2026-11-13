// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import type { JiraIssue, JiraStatus, JiraTransition } from '../../../../../shared/jira/jira-types'
import { getDefaultTaskBoardSettings } from '../../../../../shared/task-board/task-board-settings'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'

const moves = vi.hoisted(() => ({
  loadJira: vi.fn(),
  applyJira: vi.fn()
}))

vi.mock('./task-board-provider-moves', () => ({
  requireTaskBoardTarget: () => ({ kind: 'local' }),
  taskBoardMoveErrorMessage: (cause: unknown) =>
    cause instanceof Error ? cause.message : 'Failed to change status.',
  loadJiraTaskBoardMoveTransitions: moves.loadJira,
  applyJiraTaskBoardMove: moves.applyJira,
  loadLinearTaskBoardMoveStates: vi.fn(),
  applyLinearTaskBoardMove: vi.fn(),
  applyTaskBoardLabelMove: vi.fn()
}))
vi.mock('@/components/task-page/jira/task-page-jira-board-move-dialog', () => ({
  JiraBoardMoveDialog: () => null
}))
vi.mock('./TaskBoardChoiceDialog', () => ({ TaskBoardChoiceDialog: () => null }))

import { useTaskBoardMove } from './use-task-board-move'

const todo: JiraStatus = { id: '1', name: 'To Do', categoryKey: 'new', categoryName: 'To Do' }
const review: JiraStatus = { ...todo, id: '2', name: 'Review', categoryKey: 'indeterminate' }
const testing: JiraStatus = { ...todo, id: '3', name: 'Testing', categoryKey: 'indeterminate' }
const transitions: JiraTransition[] = [
  { id: '21', name: 'Review', to: review },
  { id: '31', name: 'Testing', to: testing }
]
const columns: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'completed', label: 'Done' }
]

function jiraCard(key: string): TaskBoardCard {
  const issue: JiraIssue = {
    id: key,
    key,
    title: key,
    url: `https://jira.example.com/browse/${key}`,
    project: { id: '1', key: 'APP', name: 'App' },
    issueType: { id: '1', name: 'Task' },
    status: todo,
    labels: [],
    createdAt: '',
    updatedAt: ''
  }
  return {
    refKey: `jira::${key}`,
    provider: 'jira',
    displayId: key,
    title: key,
    url: issue.url,
    projectLabel: 'APP',
    statusName: todo.name,
    category: 'todo',
    labels: [],
    updatedAt: '',
    source: { provider: 'jira', item: issue }
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useTaskBoardMove', () => {
  it('keeps an open Jira dialog when a second Jira card is dropped', async () => {
    moves.loadJira.mockResolvedValue(transitions)
    const onMoved = vi.fn()
    const { result } = renderHook(() =>
      useTaskBoardMove({
        columns,
        settings: getDefaultTaskBoardSettings(),
        accountHostId: 'local',
        onMoved
      })
    )
    const first = jiraCard('APP-1')
    const second = jiraCard('APP-2')

    await act(() => result.current.move(first, 'in-progress'))
    await act(() => result.current.move(second, 'in-progress'))

    expect(moves.loadJira).toHaveBeenCalledTimes(1)
    expect([...result.current.updatingRefKeys]).toEqual(['jira::APP-1'])
    expect(result.current.error).toBe('Finish the open move first')
    expect(onMoved).not.toHaveBeenCalled()
  })
})
