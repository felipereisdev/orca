// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../../shared/task-board/task-board-wire-types'

const host = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ settings: null })
}))
vi.mock('@/runtime/task-board/runtime-task-board-client', () => ({ listTaskBoard: host.list }))

import { useTaskBoardCards } from './use-task-board-cards'

function board(updatedAt: string): TaskBoardListResult {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook stores cards as the host sent them; a Jira card needs no relabelling.
  const card = {
    refKey: 'jira:site:APP-9',
    provider: 'jira',
    columnId: 'todo',
    updatedAt,
    source: { provider: 'jira', item: {} }
  } as TaskBoardWireCard
  return {
    columns: [{ id: 'todo', label: 'Todo' }],
    doneColumnId: 'todo',
    cards: [card],
    providers: {
      github: { status: 'ready' },
      gitlab: { status: 'ready' },
      linear: { status: 'ready' },
      jira: { status: 'ready' }
    },
    generatedAt: updatedAt
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useTaskBoardCards', () => {
  it('shows a list that landed after the board unmounted when the board mounts again', async () => {
    host.list.mockResolvedValue(board('2026-11-01T00:00:00Z'))
    const first = renderHook(() => useTaskBoardCards('runtime:late-host'))
    await act(async () => {})
    first.unmount()

    // A move that settles after unmount re-lists through the old instance.
    const after = board('2026-11-02T00:00:00Z')
    host.list.mockResolvedValue(after)
    await first.result.current.reread()

    const second = renderHook(() => useTaskBoardCards('runtime:late-host'))
    expect(second.result.current.state.cards).toEqual(after.cards)
  })
})
