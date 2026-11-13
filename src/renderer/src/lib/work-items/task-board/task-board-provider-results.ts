import { translate } from '@/i18n/i18n'
import { readIpcErrorDetail } from '@/runtime/errors/ipc-error'
import { TASK_BOARD_DONE_WINDOW_DAYS } from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
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
  return {
    cards: [],
    providers: {
      github: { status: 'loading' },
      gitlab: { status: 'loading' },
      linear: { status: 'loading' },
      jira: { status: 'loading' }
    }
  }
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

export function disconnectedTaskBoardResult(provider: TaskProvider): TaskBoardProviderResult {
  return { provider, status: 'disconnected', cards: [] }
}

export function failedTaskBoardResult(
  provider: TaskProvider,
  error: unknown
): TaskBoardProviderResult {
  return {
    provider,
    status: 'error',
    cards: [],
    error:
      (typeof error === 'string' ? error : readIpcErrorDetail(error)) ??
      translate('taskBoard.loadFailed', 'Could not load issues. Refresh to try again.')
  }
}
