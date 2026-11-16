// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  placeTaskBoardCards,
  TASK_BOARD_MOVE_OVERRIDE_TTL_MS
} from '../../../../../shared/task-board/task-board-move-overrides'
import type { ExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import type { JiraIssue } from '../../../../../shared/jira/jira-types'
import type {
  TaskBoardMoveResult,
  TaskBoardWireCard
} from '../../../../../shared/task-board/task-board-wire-types'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'

const host = vi.hoisted(() => ({ move: vi.fn() }))

vi.mock('@/runtime/task-board/runtime-task-board-client', () => ({
  moveTaskBoardCard: host.move
}))

import { useTaskBoardMove } from './use-task-board-move'

const columns: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'completed', label: 'Done' }
]
const progress = {
  worktreeId: 'wt-1',
  branch: 'app-1',
  commitsAhead: 2,
  review: null,
  checks: 'none' as const
}

function jiraCard(key: string, columnId = 'todo', updatedAt = ''): TaskBoardWireCard {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: moves read only the card's identity and ref; the issue is a stand-in.
  const issue = { key } as JiraIssue
  return {
    refKey: `jira::${key}`,
    ref: { provider: 'jira', siteId: null, key },
    provider: 'jira',
    displayId: key,
    title: key,
    url: `https://jira.example.com/browse/${key}`,
    projectLabel: 'APP',
    project: { key: 'jira::APP', provider: 'jira', label: 'APP' },
    statusName: 'To Do',
    category: 'todo',
    columnId,
    moveTargets: columns
      .filter((column) => column.id !== columnId)
      .map((column) => ({ columnId: column.id, allowed: true as const })),
    labels: [],
    updatedAt,
    source: { provider: 'jira', item: issue }
  }
}

function renderMove(reread = vi.fn(async () => {}), accountHostId: ExecutionHostId = 'local') {
  return renderHook(() => useTaskBoardMove({ columns, accountHostId, reread }))
}

function answer(result: TaskBoardMoveResult): void {
  host.move.mockResolvedValue(result)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useTaskBoardMove', () => {
  it('keeps a confirmed move in its target column, with the card’s progress, while the list is stale', async () => {
    const stale = { ...jiraCard('APP-3'), progress }
    const moved = jiraCard('APP-3', 'in-progress', '2026-11-13T10:00:00Z')
    answer({ status: 'moved', card: moved })
    const { result } = renderMove(undefined, 'runtime:confirmed-host')

    await act(() => result.current.move(stale, 'in-progress'))

    expect(placeTaskBoardCards([stale], result.current.overrides)).toEqual([
      { card: { ...moved, progress }, columnId: 'in-progress' }
    ])
  })

  it('keeps the card where it was dropped when the host applied the move but could not re-read it', async () => {
    const stale = jiraCard('APP-5')
    answer({ status: 'moved', card: null })
    const { result } = renderMove(undefined, 'runtime:null-card-host')

    await act(() => result.current.move(stale, 'completed'))

    expect(placeTaskBoardCards([stale], result.current.overrides)).toEqual([
      { card: { ...stale, columnId: 'completed' }, columnId: 'completed' }
    ])
  })

  it('puts the card back when the host refuses the move', async () => {
    const card = jiraCard('APP-6')
    answer({ status: 'blocked', reason: 'no-transition' })
    const { result } = renderMove(undefined, 'runtime:blocked-host')

    await act(() => result.current.move(card, 'completed'))

    expect(placeTaskBoardCards([card], result.current.overrides)).toEqual([
      { card, columnId: 'todo' }
    ])
  })

  it('leaves a second Jira card in its column while the first card’s dialog is open', async () => {
    answer({
      status: 'needs-choice',
      choices: [
        { id: '21', name: 'Review', fields: null },
        { id: '31', name: 'Testing', fields: null }
      ]
    })
    const { result } = renderMove(undefined, 'runtime:dialog-host')
    const first = jiraCard('APP-1')
    const second = jiraCard('APP-2')

    await act(() => result.current.move(first, 'in-progress'))
    await act(() => result.current.move(second, 'in-progress'))

    expect(placeTaskBoardCards([first, second], result.current.overrides)).toEqual([
      { card: first, columnId: 'in-progress' },
      { card: second, columnId: 'todo' }
    ])
  })

  it('refuses a drop on a column the host marked as blocked', () => {
    const card = {
      ...jiraCard('APP-8'),
      moveTargets: [
        { columnId: 'in-progress', allowed: true as const },
        { columnId: 'completed', allowed: false as const, reason: 'no-mapping' as const }
      ]
    }
    const { result } = renderMove(undefined, 'runtime:can-drop-host')

    expect(result.current.canDrop(card, 'completed').ok).toBe(false)
    expect(result.current.canDrop(card, 'in-progress').ok).toBe(true)
  })

  it('lists the board again when a held move expires and then shows what that list says', async () => {
    vi.useFakeTimers()
    const stale = jiraCard('APP-4')
    const moved = jiraCard('APP-4', 'in-progress', '2026-11-13T10:00:00Z')
    answer({ status: 'moved', card: moved })
    let finishReread: () => void = () => {}
    const reread = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReread = resolve
        })
    )
    const { result } = renderMove(reread, 'runtime:expiry-host')
    await act(() => result.current.move(stale, 'in-progress'))

    await act(() => vi.advanceTimersByTimeAsync(TASK_BOARD_MOVE_OVERRIDE_TTL_MS))

    // Still held while the fresh list is in flight, so the card does not snap back early.
    expect(placeTaskBoardCards([stale], result.current.overrides)).toEqual([
      { card: moved, columnId: 'in-progress' }
    ])

    await act(async () => finishReread())

    // The fresh list still says Todo: the host is now authoritative.
    expect(placeTaskBoardCards([stale], result.current.overrides)).toEqual([
      { card: stale, columnId: 'todo' }
    ])
  })
})
