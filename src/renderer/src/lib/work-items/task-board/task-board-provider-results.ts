import { TASK_BOARD_DONE_WINDOW_DAYS } from '../../../../../shared/task-board/task-board-settings'
import { TASK_PROVIDERS, type TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { TaskBoardCard } from './task-board-card'

export type TaskBoardProviderResult = {
  provider: TaskProvider
  status: 'ready' | 'error' | 'disconnected'
  cards: TaskBoardCard[]
  error?: string
}

export type TaskBoardProviderState = {
  status: 'loading' | 'ready' | 'error' | 'disconnected'
  error?: string
}

export type TaskBoardCardsState = {
  cards: TaskBoardCard[]
  providers: Record<TaskProvider, TaskBoardProviderState>
}

const DAY_MS = 24 * 60 * 60 * 1000

export function emptyTaskBoardCardsState(): TaskBoardCardsState {
  const providers = {} as Record<TaskProvider, TaskBoardProviderState>
  for (const provider of TASK_PROVIDERS) {
    providers[provider] = { status: 'loading' }
  }
  return { cards: [], providers }
}

function updatedAtMs(card: TaskBoardCard): number {
  const ms = Date.parse(card.updatedAt)
  return Number.isNaN(ms) ? 0 : ms
}

export function mergeTaskBoardProviderResult(
  state: TaskBoardCardsState,
  result: TaskBoardProviderResult
): TaskBoardCardsState {
  const byRefKey = new Map<string, TaskBoardCard>()
  const candidates = [
    ...state.cards.filter((card) => card.provider !== result.provider),
    ...result.cards
  ]
  for (const card of candidates) {
    const current = byRefKey.get(card.refKey)
    if (!current || updatedAtMs(card) > updatedAtMs(current)) {
      byRefKey.set(card.refKey, card)
    }
  }
  const cards = [...byRefKey.values()].sort((a, b) => updatedAtMs(b) - updatedAtMs(a))
  const providerState: TaskBoardProviderState =
    result.error === undefined
      ? { status: result.status }
      : { status: result.status, error: result.error }
  return { cards, providers: { ...state.providers, [result.provider]: providerState } }
}

export function isWithinDoneWindow(updatedAt: string, now: Date): boolean {
  const ms = Date.parse(updatedAt)
  return !Number.isNaN(ms) && now.getTime() - ms <= TASK_BOARD_DONE_WINDOW_DAYS * DAY_MS
}
