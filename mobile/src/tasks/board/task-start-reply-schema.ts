import * as z from 'zod'
import type {
  TaskStartAgentCatalogEntry,
  TaskStartOptionsResult,
  TaskStartResult,
  TaskStopResult
} from '../../../../src/shared/task-board/task-board-wire-types'
import {
  TASK_START_ROLES,
  type TaskStartAgentChoice,
  type TaskStartRole
} from '../../../../src/shared/task-board/task-start-settings'
import {
  openEnum,
  salvagedField,
  salvagedOptional,
  salvagingArray
} from '../../../../src/shared/zod-salvage'
import { taskStartSummarySchema } from './task-board-reply-schema'

// The host owns agents and roles; the phone only checks the shape it draws from.

const named = z.looseObject({ id: z.string(), label: z.string() })

const catalogEntry = z.custom<TaskStartAgentCatalogEntry>(
  (value) =>
    z
      .looseObject({
        agent: z.string(),
        label: z.string(),
        models: z.array(named.extend({ efforts: z.array(named) }))
      })
      .safeParse(value).success
)

const agentChoice = z.looseObject({ agent: z.string() })

function isRoleRecord<T>(value: unknown, entry: z.ZodType<T>): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    TASK_START_ROLES.every((role) => entry.safeParse(Reflect.get(value, role)).success)
  )
}

const roles = z.custom<Record<TaskStartRole, TaskStartAgentChoice>>((value) =>
  isRoleRecord(value, agentChoice)
)
const labels = z.custom<Record<TaskStartRole, string>>((value) => isRoleRecord(value, z.string()))

export const taskStartOptionsSchema: z.ZodType<TaskStartOptionsResult, unknown> = z.looseObject({
  repoId: salvagedField('repoId', z.string().nullable(), () => null),
  repoCandidates: salvagingArray(z.string()),
  repos: salvagingArray(
    z.looseObject({ id: z.string(), label: z.string(), kind: z.enum(['git', 'folder']) })
  ),
  workspaceMode: openEnum(['worktree', 'primary'], 'worktree'),
  baseRef: salvagedField('baseRef', z.string().nullable(), () => null),
  roles: salvagedField('roles', roles.nullable(), () => null),
  labels: salvagedField('labels', labels.nullable(), () => null),
  catalog: salvagingArray(catalogEntry),
  invalidRoles: salvagingArray(z.enum(TASK_START_ROLES))
})

const START_ERRORS = [
  'repo_unresolved',
  'already_running',
  'primary_busy',
  'primary_needs_confirmation',
  'agent_unavailable',
  'account_needs_sign_in',
  'worktree_create_failed',
  'context_fetch_failed',
  'launch_failed',
  'cancelled'
] as const

export const taskStartResultSchema: z.ZodType<TaskStartResult, unknown> = z.discriminatedUnion(
  'ok',
  [
    z.object({ ok: z.literal(true), run: taskStartSummarySchema }),
    z.object({
      ok: z.literal(false),
      // A newer host's error reads as the generic launch failure.
      error: openEnum(START_ERRORS, 'launch_failed'),
      reasons: salvagedOptional('reasons', salvagingArray(z.enum(['uncommitted', 'other-branch']))),
      run: salvagedOptional('run', taskStartSummarySchema)
    })
  ]
)

export const taskStopResultSchema: z.ZodType<TaskStopResult, unknown> = z.looseObject({
  ok: z.literal(true),
  run: salvagedField('run', taskStartSummarySchema.nullable(), () => null),
  agents: salvagedOptional('agents', z.number())
})
