// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
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
    renderHook(() => useTaskBoardCards('local'))
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
})
