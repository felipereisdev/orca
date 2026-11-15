import type React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { TaskStartAgentCatalogEntry } from '../../../../shared/task-board/task-board-wire-types'
import {
  TASK_START_ROLES,
  type TaskStartRole,
  type TaskStartRoles
} from '../../../../shared/task-board/task-start-settings'
import { TaskStartRolePicker } from './TaskStartRolePicker'

export function TaskStartRolesEditor({
  catalog,
  roles,
  inherited,
  invalidRoles,
  onChange
}: {
  catalog: TaskStartAgentCatalogEntry[]
  roles: TaskStartRoles
  inherited?: Record<TaskStartRole, string>
  invalidRoles?: TaskStartRole[]
  onChange: (next: TaskStartRoles) => void
}): React.JSX.Element {
  const t = useTranslate()
  const labels: Record<TaskStartRole, string> = {
    orchestrator: t('taskStart.roles.orchestrator', 'Orchestrator'),
    planner: t('taskStart.roles.planner', 'Planner'),
    planReviewer: t('taskStart.roles.planReviewer', 'Plan reviewer'),
    implementer: t('taskStart.roles.implementer', 'Implementer'),
    reviewer: t('taskStart.roles.reviewer', 'Reviewer'),
    qa: t('taskStart.roles.qa', 'QA')
  }
  return (
    <div className="flex flex-col gap-3">
      {TASK_START_ROLES.map((role) => (
        <div
          key={role}
          className="flex min-w-0 flex-col gap-1"
          aria-invalid={invalidRoles?.includes(role) ? true : undefined}
        >
          <div
            className={
              invalidRoles?.includes(role)
                ? 'text-xs font-medium text-destructive'
                : 'text-xs font-medium text-muted-foreground'
            }
          >
            {labels[role]}
          </div>
          <TaskStartRolePicker
            catalog={catalog}
            value={roles[role]}
            invalid={invalidRoles?.includes(role)}
            inheritLabel={inherited?.[role]}
            ariaLabel={labels[role]}
            onChange={(next) => {
              const { [role]: _removed, ...rest } = roles
              onChange(next ? { ...rest, [role]: next } : rest)
            }}
          />
        </div>
      ))}
    </div>
  )
}
