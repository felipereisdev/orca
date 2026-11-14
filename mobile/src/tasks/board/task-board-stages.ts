import type { TaskProvider } from '../../../../src/shared/work-items/task-providers'
import {
  matchesTaskBoardProjects,
  type TaskBoardProject
} from '../../../../src/shared/task-board/task-board-project-filter'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import type { WorkspaceStatusDefinition } from '../../../../src/shared/worktree/types'

/** Empty sets mean "everything": no provider or project is picked. */
export type TaskBoardFilter = {
  providers: ReadonlySet<TaskProvider>
  projects: ReadonlyMap<string, TaskBoardProject>
}

export const NO_TASK_BOARD_FILTER: TaskBoardFilter = { providers: new Set(), projects: new Map() }

export function taskBoardFilterCount(filter: TaskBoardFilter): number {
  return filter.providers.size + filter.projects.size
}

export function matchesTaskBoardFilter(card: TaskBoardWireCard, filter: TaskBoardFilter): boolean {
  return (
    (filter.providers.size === 0 || filter.providers.has(card.provider)) &&
    matchesTaskBoardProjects(card, filter.projects)
  )
}

// The host's rule for the column it never enriches (resolveCategoryColumnId('todo')).
function todoColumnId(columns: readonly WorkspaceStatusDefinition[]): string | null {
  return columns.some((column) => column.id === 'todo') ? 'todo' : (columns[0]?.id ?? null)
}

export type TaskBoardStage = {
  id: string
  label: string
  cards: TaskBoardWireCard[]
  /** Cards with comments the user has not seen. */
  withUnread: number
  /** Work under way: the host sends progress and comments for these cards. */
  started: boolean
}

/** One stage per host column, holding the filtered cards the host placed there, in the host's order. */
export function taskBoardStages(
  board: TaskBoardListResult,
  filter: TaskBoardFilter
): TaskBoardStage[] {
  const todo = todoColumnId(board.columns)
  const visible = board.cards.filter((card) => matchesTaskBoardFilter(card, filter))
  return board.columns.map((column) => {
    const cards = visible.filter((card) => card.columnId === column.id)
    return {
      id: column.id,
      label: column.label,
      cards,
      withUnread: cards.filter((card) => (card.unreadComments ?? 0) > 0).length,
      started: column.id !== todo && column.id !== board.doneColumnId
    }
  })
}

/** No provider is connected on the host, so there is nothing a board could show. */
export function taskBoardAllDisconnected(board: TaskBoardListResult): boolean {
  return Object.values(board.providers).every((state) => state.status === 'disconnected')
}
