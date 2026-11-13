import {
  emptyTaskBoardCardsState,
  type TaskBoardCardsState
} from '@/lib/work-items/task-board/task-board-provider-results'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

// Why: opening a card's detail unmounts the board; returning should show the last cards and chips at once.
const cardsByAccountHost = new Map<ExecutionHostId, TaskBoardCardsState>()
let hiddenProviders: ReadonlySet<TaskProvider> = new Set()

export function readTaskBoardCards(accountHostId: ExecutionHostId): TaskBoardCardsState {
  return cardsByAccountHost.get(accountHostId) ?? emptyTaskBoardCardsState()
}

export function writeTaskBoardCards(
  accountHostId: ExecutionHostId,
  state: TaskBoardCardsState
): void {
  cardsByAccountHost.set(accountHostId, state)
}

export function readHiddenTaskBoardProviders(): ReadonlySet<TaskProvider> {
  return hiddenProviders
}

export function writeHiddenTaskBoardProviders(providers: ReadonlySet<TaskProvider>): void {
  hiddenProviders = providers
}
