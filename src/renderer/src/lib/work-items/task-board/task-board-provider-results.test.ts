import { describe, expect, it } from 'vitest'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { TaskBoardCard } from './task-board-card'
import {
  emptyTaskBoardCardsState,
  isWithinDoneWindow,
  mergeTaskBoardProviderResult
} from './task-board-provider-results'

function card(provider: TaskProvider, refKey: string, updatedAt: string): TaskBoardCard {
  return {
    refKey,
    provider,
    displayId: refKey,
    title: refKey,
    url: `https://example.test/${refKey}`,
    projectLabel: 'P',
    statusName: 'Todo',
    category: 'todo',
    labels: [],
    updatedAt,
    source: {} as TaskBoardCard['source']
  }
}

describe('mergeTaskBoardProviderResult', () => {
  it('keeps ready cards from one provider when another provider fails', () => {
    const jira = card('jira', 'jira::A-1', '2026-11-10T00:00:00Z')
    let state = mergeTaskBoardProviderResult(emptyTaskBoardCardsState(), {
      provider: 'jira',
      status: 'ready',
      cards: [jira]
    })
    state = mergeTaskBoardProviderResult(state, {
      provider: 'gitlab',
      status: 'error',
      cards: [],
      error: 'boom'
    })
    expect(state.cards).toEqual([jira])
    expect(state.providers.jira).toEqual({ status: 'ready' })
    expect(state.providers.gitlab).toEqual({ status: 'error', error: 'boom' })
    expect(state.providers.linear).toEqual({ status: 'loading' })
  })

  it('dedupes cards by refKey keeping the most recently updated one', () => {
    const older = card('github', 'github::r:1', '2026-11-01T00:00:00Z')
    const newer = { ...card('github', 'github::r:1', '2026-11-10T00:00:00Z'), title: 'newer' }
    const state = mergeTaskBoardProviderResult(emptyTaskBoardCardsState(), {
      provider: 'github',
      status: 'ready',
      cards: [older, newer]
    })
    expect(state.cards).toEqual([newer])
  })

  it('replaces a provider’s previous cards and sorts all cards by updatedAt descending', () => {
    const linear = card('linear', 'linear::L-1', '2026-11-05T00:00:00Z')
    let state = mergeTaskBoardProviderResult(emptyTaskBoardCardsState(), {
      provider: 'linear',
      status: 'ready',
      cards: [linear]
    })
    state = mergeTaskBoardProviderResult(state, {
      provider: 'jira',
      status: 'ready',
      cards: [card('jira', 'jira::A-1', '2026-11-01T00:00:00Z')]
    })
    const replacement = card('jira', 'jira::A-2', '2026-11-08T00:00:00Z')
    state = mergeTaskBoardProviderResult(state, {
      provider: 'jira',
      status: 'ready',
      cards: [replacement]
    })
    expect(state.cards.map((c) => c.refKey)).toEqual(['jira::A-2', 'linear::L-1'])
  })
})

describe('isWithinDoneWindow', () => {
  it('accepts items updated within the last 14 days only', () => {
    const now = new Date('2026-11-13T00:00:00Z')
    expect(isWithinDoneWindow('2026-10-29T00:00:00Z', now)).toBe(false)
    expect(isWithinDoneWindow('2026-10-31T00:00:00Z', now)).toBe(true)
  })
})
