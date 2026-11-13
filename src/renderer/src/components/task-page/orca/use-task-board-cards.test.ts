// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

const loaders = vi.hoisted(() => ({
  github: vi.fn(),
  gitlab: vi.fn(),
  linear: vi.fn(),
  jira: vi.fn()
}))

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  return {
    useAppStore: create(() => ({
      repos: [],
      preflightStatus: null,
      preflightStatusChecked: false,
      settings: null
    }))
  }
})
vi.mock('@/lib/work-items/task-board/adapters/github-task-board-adapter', () => ({
  listGitHubTaskBoardCards: loaders.github
}))
vi.mock('@/lib/work-items/task-board/adapters/gitlab-task-board-adapter', () => ({
  listGitLabTaskBoardCards: loaders.gitlab
}))
vi.mock('@/lib/work-items/task-board/adapters/linear-task-board-adapter', () => ({
  listLinearTaskBoardCards: loaders.linear
}))
vi.mock('@/lib/work-items/task-board/adapters/jira-task-board-adapter', () => ({
  listJiraTaskBoardCards: loaders.jira
}))

import { useAppStore } from '@/store'
import { useTaskBoardCards } from './use-task-board-cards'

const serverRepo: Repo = {
  id: 'server-repo',
  path: '/srv/app',
  displayName: 'app',
  badgeColor: '',
  addedAt: 1,
  executionHostId: 'runtime:build-box'
}

function callCounts(): Record<TaskProvider, number> {
  return {
    github: loaders.github.mock.calls.length,
    gitlab: loaders.gitlab.mock.calls.length,
    linear: loaders.linear.mock.calls.length,
    jira: loaders.jira.mock.calls.length
  }
}

beforeEach(() => {
  for (const provider of ['github', 'gitlab', 'linear', 'jira'] as const) {
    loaders[provider].mockReset().mockResolvedValue({ provider, status: 'ready', cards: [] })
  }
  useAppStore.setState({ repos: [], settings: null })
})

afterEach(cleanup)

describe('useTaskBoardCards', () => {
  it('reloads only the repo-backed providers when repos hydrate after mount', async () => {
    renderHook(() => useTaskBoardCards('local'))
    expect(callCounts()).toEqual({ github: 1, gitlab: 1, linear: 1, jira: 1 })

    await act(async () => useAppStore.setState({ repos: [serverRepo] }))
    expect(callCounts()).toEqual({ github: 2, gitlab: 2, linear: 1, jira: 1 })

    // A new repo object with the same id, host and path is not a new scope.
    await act(async () => useAppStore.setState({ repos: [{ ...serverRepo }] }))
    expect(callCounts()).toEqual({ github: 2, gitlab: 2, linear: 1, jira: 1 })
  })

  it('reloads a provider when its visibility changes', async () => {
    renderHook(() => useTaskBoardCards('runtime:visibility-host'))
    await act(async () =>
      useAppStore.setState({
        settings: {
          ...getDefaultSettings('/home'),
          visibleTaskProviders: ['github', 'gitlab', 'jira']
        }
      })
    )
    expect(callCounts()).toEqual({ github: 1, gitlab: 1, linear: 2, jira: 1 })
  })

  it('shows the last cards on remount and reloads only providers read over 45s ago', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook only merges cards by refKey, provider and updatedAt.
    const card = {
      refKey: 'jira:site:APP-1',
      provider: 'jira',
      updatedAt: '2026-11-01T00:00:00Z'
    } as TaskBoardCard
    loaders.jira.mockResolvedValue({ provider: 'jira', status: 'ready', cards: [card] })
    const first = renderHook(() => useTaskBoardCards('runtime:cache-host'))
    await act(async () => {})
    first.unmount()

    now.mockReturnValue(1_044_000)
    const second = renderHook(() => useTaskBoardCards('runtime:cache-host'))
    expect(second.result.current.state.cards).toEqual([card])
    expect(second.result.current.state.providers.jira).toEqual({ status: 'ready' })
    expect(callCounts()).toEqual({ github: 1, gitlab: 1, linear: 1, jira: 1 })
    second.unmount()

    now.mockReturnValue(1_045_000)
    loaders.jira.mockReturnValue(new Promise(() => {}))
    const third = renderHook(() => useTaskBoardCards('runtime:cache-host'))
    expect(third.result.current.state.cards).toEqual([card])
    expect(third.result.current.state.providers.jira).toEqual({
      status: 'ready',
      refreshing: true
    })
    expect(callCounts()).toEqual({ github: 2, gitlab: 2, linear: 2, jira: 2 })
    now.mockRestore()
  })

  it('bypasses provider caches on Refresh but not on mount', () => {
    const { result } = renderHook(() => useTaskBoardCards('runtime:refresh-host'))
    expect(loaders.github).toHaveBeenLastCalledWith(expect.any(AbortSignal), {})

    act(() => result.current.refresh())

    expect(loaders.github).toHaveBeenLastCalledWith(expect.any(AbortSignal), { fresh: true })
  })
})
