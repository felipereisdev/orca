// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskBoardWireCard } from '../../../../../shared/task-board/task-board-wire-types'

const host = vi.hoisted(() => ({ markSeen: vi.fn(async () => {}) }))

vi.mock('@/runtime/task-board/runtime-task-board-client', () => ({
  markTaskBoardSeen: host.markSeen
}))

import { rememberTaskBoardDetailCard, useTaskBoardSeenMarker } from './task-board-seen-marker'

const url = 'https://jira.example.com/browse/APP-1'
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: marking reads only the card's identity, url and ref.
const card = {
  refKey: 'jira:site-a:APP-1',
  ref: { provider: 'jira', siteId: 'site-a', key: 'APP-1' },
  provider: 'jira',
  url,
  source: { provider: 'jira', item: {} }
} as TaskBoardWireCard
const comments = [
  { id: '11', createdAt: '2026-11-14T10:00:00Z' },
  { id: '13', createdAt: '2026-11-14T12:00:00Z' },
  { id: '12', createdAt: '2026-11-14T11:00:00Z' }
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useTaskBoardSeenMarker', () => {
  it('marks the newest comment the board-opened detail rendered', () => {
    rememberTaskBoardDetailCard('runtime:board-host', card)
    const { result } = renderHook(() => useTaskBoardSeenMarker(true))

    result.current?.({ provider: 'jira', url, comments })

    expect(host.markSeen).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'board-host' },
      { provider: 'jira', siteId: 'site-a', key: 'APP-1' },
      { at: '2026-11-14T12:00:00Z', id: '13' }
    )
  })

  it('marks nothing for another issue shown on the detail page', () => {
    rememberTaskBoardDetailCard('runtime:board-host', card)
    const { result } = renderHook(() => useTaskBoardSeenMarker(true))

    result.current?.({ provider: 'jira', url: 'https://jira.example.com/browse/APP-2', comments })

    expect(host.markSeen).not.toHaveBeenCalled()
  })

  it('gives no marker to a detail opened outside the board', () => {
    rememberTaskBoardDetailCard('runtime:board-host', card)
    const { result } = renderHook(() => useTaskBoardSeenMarker(false))

    expect(result.current).toBeUndefined()
  })
})
