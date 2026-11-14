import {
  emptyTaskBoardCardsState,
  type TaskBoardCardsState
} from '@/lib/work-items/task-board/task-board-provider-results'
import type { TaskBoardProject } from '@/lib/work-items/task-board/task-board-project-filter'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

// Why: opening a card's detail unmounts the board; returning should show the last cards and chips at once.
const cardsByAccountHost = new Map<ExecutionHostId, TaskBoardCardsState>()
/** When a provider's last result arrived, and for which provider scope. */
type TaskBoardProviderLoad = { at: number; scopeKey: string }
const loadsByAccountHost = new Map<
  ExecutionHostId,
  Partial<Record<TaskProvider, TaskBoardProviderLoad>>
>()
let hiddenProviders: ReadonlySet<TaskProvider> = new Set()
let projectSelection: ReadonlyMap<string, TaskBoardProject> = new Map()

export function readTaskBoardCards(accountHostId: ExecutionHostId): TaskBoardCardsState {
  return cardsByAccountHost.get(accountHostId) ?? emptyTaskBoardCardsState()
}

export function writeTaskBoardCards(
  accountHostId: ExecutionHostId,
  state: TaskBoardCardsState
): void {
  cardsByAccountHost.set(accountHostId, state)
}

export function readTaskBoardProviderLoaded(
  accountHostId: ExecutionHostId,
  provider: TaskProvider
): TaskBoardProviderLoad | undefined {
  return loadsByAccountHost.get(accountHostId)?.[provider]
}

export function markTaskBoardProviderLoaded(
  accountHostId: ExecutionHostId,
  provider: TaskProvider,
  load: TaskBoardProviderLoad
): void {
  loadsByAccountHost.set(accountHostId, {
    ...loadsByAccountHost.get(accountHostId),
    [provider]: load
  })
}

export function readHiddenTaskBoardProviders(): ReadonlySet<TaskProvider> {
  return hiddenProviders
}

export function writeHiddenTaskBoardProviders(providers: ReadonlySet<TaskProvider>): void {
  hiddenProviders = providers
}

export function readTaskBoardProjectSelection(): ReadonlyMap<string, TaskBoardProject> {
  return projectSelection
}

export function writeTaskBoardProjectSelection(
  selection: ReadonlyMap<string, TaskBoardProject>
): void {
  projectSelection = selection
}
