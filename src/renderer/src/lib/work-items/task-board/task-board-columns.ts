import type {
  TaskBoardRule,
  TaskBoardSettings
} from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import type { TaskBoardStatusCategory } from './task-board-card'

export type TaskBoardStatusInput = {
  provider: TaskProvider
  statusName: string
  category: TaskBoardStatusCategory
  labels: readonly string[]
}

export function normalizeTaskBoardMatch(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** Rules pointing at a column that no longer exists are ignored. */
export function getActiveTaskBoardRules(
  provider: TaskProvider,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): TaskBoardRule[] {
  return settings.providers[provider].rules.filter((rule) =>
    columns.some((column) => column.id === rule.statusId)
  )
}

export function resolveCategoryColumnId(
  category: Exclude<TaskBoardStatusCategory, 'excluded'>,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): string | null {
  if (columns.length === 0) {
    return null
  }
  const has = (id: string): boolean => columns.some((column) => column.id === id)
  if (category === 'done') {
    return has(settings.doneStatusId) ? settings.doneStatusId : columns.at(-1)!.id
  }
  return has(category) ? category : columns.at(0)!.id
}

export function resolveTaskBoardColumnId(
  input: TaskBoardStatusInput,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): string | null {
  if (input.category === 'excluded') {
    return null
  }
  const rules = getActiveTaskBoardRules(input.provider, columns, settings)
  if (input.provider === 'jira' || input.provider === 'linear') {
    const status = normalizeTaskBoardMatch(input.statusName)
    const hit = rules.find((rule) => normalizeTaskBoardMatch(rule.match) === status)
    if (hit) {
      return hit.statusId
    }
  } else if (input.category !== 'done') {
    const labels = new Set(input.labels.map(normalizeTaskBoardMatch))
    const hit = rules.find((rule) => labels.has(normalizeTaskBoardMatch(rule.match)))
    if (hit) {
      return hit.statusId
    }
  }
  return resolveCategoryColumnId(input.category, columns, settings)
}
