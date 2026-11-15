import type {
  TaskStartAgentChoice,
  TaskStartRole
} from '../../../../shared/task-board/task-start-settings'
import type { TaskStartAgentCatalogEntry } from '../../../../shared/task-board/task-board-wire-types'
import { taskStartRoleLabel } from '../../../../shared/task-board/task-start-prompt'

/** "Claude (Ucloud) · opus · high": the catalog label when known, else the agent name. */
export function taskStartChoiceLabel(
  choice: TaskStartAgentChoice,
  catalog: TaskStartAgentCatalogEntry[]
): string {
  const entry = catalog.find(
    (candidate) =>
      candidate.agent === choice.agent &&
      (candidate.accountId ?? null) === (choice.accountId ?? null)
  )
  if (!entry) {
    return taskStartRoleLabel(choice)
  }
  return [entry.label, choice.model, choice.model ? choice.effort : undefined]
    .filter(Boolean)
    .join(' · ')
}

export function mapTaskStartRoles<T>(pick: (role: TaskStartRole) => T): Record<TaskStartRole, T> {
  return {
    orchestrator: pick('orchestrator'),
    planner: pick('planner'),
    planReviewer: pick('planReviewer'),
    implementer: pick('implementer'),
    reviewer: pick('reviewer'),
    qa: pick('qa')
  }
}
