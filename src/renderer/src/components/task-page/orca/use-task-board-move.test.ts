// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import {
  placeTaskBoardCards,
  TASK_BOARD_MOVE_OVERRIDE_TTL_MS
} from '@/lib/work-items/task-board/task-board-move-overrides'
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
  applyLinearTaskBoardMove: vi.fn()
}))
vi.mock('./task-board-label-moves', () => ({ moveTaskBoardCardWithLabels: vi.fn() }))
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

function jiraCard(key: string, status = todo, updatedAt = ''): TaskBoardCard {
  const issue: JiraIssue = {
    id: key,
    key,
    title: key,
    url: `https://jira.example.com/browse/${key}`,
    project: { id: '1', key: 'APP', name: 'App' },
    issueType: { id: '1', name: 'Task' },
    status,
    labels: [],
    createdAt: '',
    updatedAt
  }
  return {
    refKey: `jira::${key}`,
    provider: 'jira',
    displayId: key,
    title: key,
    url: issue.url,
    projectLabel: 'APP',
    statusName: status.name,
    category: status.categoryKey === 'indeterminate' ? 'in-progress' : 'todo',
    labels: [],
    updatedAt,
    source: { provider: 'jira', item: issue }
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useTaskBoardMove', () => {
  it('keeps an open Jira dialog when a second Jira card is dropped', async () => {
    moves.loadJira.mockResolvedValue(transitions)
    const reread = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useTaskBoardMove({
        cards: [],
        columns,
        settings: getDefaultTaskBoardSettings(),
        accountHostId: 'local',
        reread
      })
    )
    const first = jiraCard('APP-1')
    const second = jiraCard('APP-2')

    await act(() => result.current.move(first, 'in-progress'))
    await act(() => result.current.move(second, 'in-progress'))

    expect(moves.loadJira).toHaveBeenCalledTimes(1)
    expect([...result.current.updatingRefKeys]).toEqual(['jira::APP-1'])
    expect(result.current.error).toBe('Finish the open move first')
    expect(reread).not.toHaveBeenCalled()
  })

  it('keeps a confirmed move in its target column when the next read is still stale', async () => {
    const stale = jiraCard('APP-3')
    const confirmed = jiraCard('APP-3', review, '2026-11-13T10:00:00Z')
    moves.loadJira.mockResolvedValue([transitions[0]])
    moves.applyJira.mockResolvedValue(confirmed)
    const settings = getDefaultTaskBoardSettings()
    const reread = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useTaskBoardMove({ cards: [], columns, settings, accountHostId: 'local', reread })
    )

    await act(() => result.current.move(stale, 'in-progress'))

    expect(reread).toHaveBeenCalledExactlyOnceWith('jira')
    // The provider re-read after the move still returns the card in To Do.
    expect(placeTaskBoardCards([stale], result.current.overrides, columns, settings)).toEqual([
      { card: confirmed, columnId: 'in-progress' }
    ])
  })

  it('re-reads the provider when a held move expires and then shows what that read says', async () => {
    vi.useFakeTimers()
    const stale = jiraCard('APP-4')
    const confirmed = jiraCard('APP-4', review, '2026-11-13T10:00:00Z')
    moves.loadJira.mockResolvedValue([transitions[0]])
    moves.applyJira.mockResolvedValue(confirmed)
    const settings = getDefaultTaskBoardSettings()
    const reread = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useTaskBoardMove({
        cards: [],
        columns,
        settings,
        accountHostId: 'runtime:expiry-host',
        reread
      })
    )
    await act(() => result.current.move(stale, 'in-progress'))
    let finishReread: () => void = () => {}
    reread.mockClear().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReread = resolve
        })
    )

    await act(() => vi.advanceTimersByTimeAsync(TASK_BOARD_MOVE_OVERRIDE_TTL_MS))

    expect(reread).toHaveBeenCalledExactlyOnceWith('jira')
    // Still held while the fresh read is in flight, so the card does not snap back early.
    expect(placeTaskBoardCards([stale], result.current.overrides, columns, settings)).toEqual([
      { card: confirmed, columnId: 'in-progress' }
    ])

    await act(async () => finishReread())

    // The fresh read still says To Do: the provider is now authoritative.
    expect(placeTaskBoardCards([stale], result.current.overrides, columns, settings)).toEqual([
      { card: stale, columnId: 'todo' }
    ])
  })
})
