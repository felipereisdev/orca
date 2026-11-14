import type { TaskBoardProject } from '../../../../../shared/task-board/task-board-project-filter'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import { emptyTaskBoardViewState, type TaskBoardViewState } from './task-board-view-state'

// Why: opening a card's detail unmounts the board; returning should show the last cards and chips at once.
const boardsByAccountHost = new Map<ExecutionHostId, TaskBoardViewState>()
/** When the host's last list arrived, and for which settings scope. */
type TaskBoardLoad = { at: number; scopeKey: string }
const loadsByAccountHost = new Map<ExecutionHostId, TaskBoardLoad>()
let hiddenProviders: ReadonlySet<TaskProvider> = new Set()
let projectSelection: ReadonlyMap<string, TaskBoardProject> = new Map()

export function readTaskBoardCards(accountHostId: ExecutionHostId): TaskBoardViewState {
  return boardsByAccountHost.get(accountHostId) ?? emptyTaskBoardViewState()
}

export function writeTaskBoardCards(
  accountHostId: ExecutionHostId,
  state: TaskBoardViewState
): void {
  boardsByAccountHost.set(accountHostId, state)
}

export function readTaskBoardLoaded(accountHostId: ExecutionHostId): TaskBoardLoad | undefined {
  return loadsByAccountHost.get(accountHostId)
}

export function markTaskBoardLoaded(accountHostId: ExecutionHostId, load: TaskBoardLoad): void {
  loadsByAccountHost.set(accountHostId, load)
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
