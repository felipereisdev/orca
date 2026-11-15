import * as z from 'zod'
import type { WorkspaceStatusDefinition } from '../../../../src/shared/worktree/types'
import type { TaskBoardCardSource } from '../../../../src/shared/task-board/task-board-card'
import type {
  TaskBoardAddCommentResult,
  TaskBoardCardRef,
  TaskBoardComment,
  TaskBoardCommentSummary,
  TaskBoardDetailResult,
  TaskBoardListResult,
  TaskBoardMoveTarget,
  TaskBoardProgress,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import {
  TASK_START_PHASES,
  type TaskStartOrchestratorRef,
  type TaskStartRunSummary
} from '../../../../src/shared/task-board/task-start-run'
import type { TaskBoardProviderState } from '../../../../src/shared/task-board/task-board-provider-results'
import {
  openEnum,
  salvagedField,
  salvagedOptional,
  salvagingArray
} from '../../../../src/shared/zod-salvage'

// Identity (ref, column, source) rejects a card; enrichment and display extras salvage older-host replies.

const PROVIDERS = ['github', 'gitlab', 'linear', 'jira'] as const
const provider = z.enum(PROVIDERS)
const text = (name: string) => salvagedOptional(name, z.string())

const ref: z.ZodType<TaskBoardCardRef, unknown> = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('jira'), siteId: z.string().nullable(), key: z.string() }),
  z.object({
    provider: z.literal('linear'),
    workspaceId: z.string().nullable(),
    id: z.string(),
    teamId: z.string()
  }),
  z.object({
    provider: z.literal('gitlab'),
    repoId: z.string(),
    number: z.number(),
    projectRef: z.object({ host: z.string(), path: z.string() }).nullable()
  }),
  z.object({
    provider: z.literal('github'),
    repoId: z.string(),
    number: z.number(),
    issueRepo: z.object({ owner: z.string(), repo: z.string() }).nullable()
  })
])

// Only what clients read from the provider item (project scope, Linear priority); the rest passes through.
const sourceShape = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('jira'),
    item: z.looseObject({ key: z.string(), project: z.looseObject({ key: z.string() }) })
  }),
  z.object({
    provider: z.literal('linear'),
    item: z.looseObject({ id: z.string(), team: z.looseObject({ id: z.string() }) })
  }),
  z.object({ provider: z.literal('gitlab'), item: z.looseObject({ repoId: z.string() }) }),
  z.object({ provider: z.literal('github'), item: z.looseObject({ repoId: z.string() }) })
])
const source = z.custom<TaskBoardCardSource>((value) => sourceShape.safeParse(value).success)

const moveTarget: z.ZodType<TaskBoardMoveTarget, unknown> = z.union([
  z.object({ columnId: z.string(), allowed: z.literal(true) }),
  z.object({
    columnId: z.string(),
    allowed: z.literal(false),
    reason: openEnum(['no-mapping'], 'no-mapping')
  })
])

const progress: z.ZodType<TaskBoardProgress, unknown> = z.object({
  worktreeId: z.string(),
  branch: z.string().nullable(),
  commitsAhead: z.number().nullable(),
  review: salvagedField(
    'review',
    z.object({ number: z.number(), url: z.string(), state: z.string() }).nullable(),
    () => null
  ),
  checks: openEnum(['success', 'failure', 'pending', 'none'], 'none')
})

const commentSummary: z.ZodType<TaskBoardCommentSummary, unknown> = z.object({
  author: z.string(),
  at: z.string(),
  excerpt: z.string()
})

const orchestratorRef = z.custom<TaskStartOrchestratorRef>(
  (value) =>
    z
      .looseObject({
        hostId: z.string(),
        agent: z.string(),
        worktreeId: z.string(),
        surface: z.enum(['terminal', 'chat'])
      })
      .safeParse(value).success
)

const taskStartSummary: z.ZodType<TaskStartRunSummary, unknown> = z.looseObject({
  id: z.string(),
  state: openEnum(['running', 'waiting', 'stopping', 'stopped', 'completed', 'failed'], 'running'),
  phase: openEnum(TASK_START_PHASES, 'starting'),
  progress: salvagedOptional(
    'progress',
    z.object({
      current: z.number(),
      total: z.number(),
      step: salvagedOptional('step', z.enum(['implementing', 'reviewing']))
    })
  ),
  note: text('note'),
  failure: salvagedOptional(
    'failure',
    z.custom<TaskStartRunSummary['failure']>((v) => typeof v === 'string')
  ),
  orchestrator: salvagedOptional('orchestrator', orchestratorRef),
  worktreeId: text('worktreeId'),
  updatedAt: z.string(),
  percent: z.number()
})

const enrichment = openEnum(['ok', 'unavailable'], 'unavailable')

const taskBoardCardSchema: z.ZodType<TaskBoardWireCard, unknown> = z.object({
  refKey: z.string(),
  provider,
  displayId: z.string(),
  title: z.string(),
  url: z.string(),
  projectLabel: z.string(),
  statusName: z.string(),
  category: openEnum(['todo', 'in-progress', 'done', 'excluded'], 'todo'),
  labels: salvagingArray(z.string()),
  priorityLabel: text('priorityLabel'),
  updatedAt: z.string(),
  source,
  ref,
  columnId: z.string(),
  project: z.object({ key: z.string(), provider, label: z.string() }),
  moveTargets: salvagingArray(moveTarget),
  enrichment: salvagedOptional('enrichment', enrichment),
  progress: salvagedOptional('progress', progress.nullable()),
  latestComment: salvagedOptional('latestComment', commentSummary.nullable()),
  unreadComments: salvagedOptional('unreadComments', z.number().int().nonnegative()),
  taskStart: salvagedOptional('taskStart', taskStartSummary.nullable())
})

const column: z.ZodType<WorkspaceStatusDefinition, unknown> = z.object({
  id: z.string(),
  label: z.string(),
  color: text('color'),
  icon: text('icon')
})

const providerState: z.ZodType<TaskBoardProviderState, unknown> = z.object({
  status: openEnum(['loading', 'ready', 'error', 'disconnected'], 'error'),
  error: salvagedOptional(
    'error',
    z.object({
      code: openEnum(['unavailable', 'auth', 'unknown'], 'unknown'),
      message: z.string()
    })
  ),
  refreshing: salvagedOptional('refreshing', z.boolean())
})

export const taskBoardListSchema: z.ZodType<TaskBoardListResult, unknown> = z.object({
  columns: salvagingArray(column),
  doneColumnId: z.string(),
  cards: salvagingArray(taskBoardCardSchema),
  providers: z.object({
    github: providerState,
    gitlab: providerState,
    linear: providerState,
    jira: providerState
  }),
  generatedAt: z.string()
})

const comment: z.ZodType<TaskBoardComment, unknown> = z.object({
  id: z.string(),
  author: z.string(),
  at: z.string(),
  body: z.string(),
  own: z.boolean()
})

export const taskBoardDetailSchema: z.ZodType<TaskBoardDetailResult, unknown> = z.object({
  card: taskBoardCardSchema,
  progress: salvagedField('progress', progress.nullable(), () => null),
  comments: salvagingArray(comment),
  enrichment
})

const named = z.object({ id: z.string(), name: z.string() })

// Older hosts send neither the resolution's Jira name nor the unsupported field names.
const choice = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.union([
    z.literal('unsupported'),
    z.null(),
    z.object({
      resolution: z
        .object({
          name: text('name'),
          required: z.boolean(),
          options: salvagingArray(named)
        })
        .nullable(),
      commentRequired: z.boolean()
    })
  ]),
  unsupportedFieldNames: salvagedOptional('unsupportedFieldNames', salvagingArray(z.string()))
})

export type MobileTaskBoardChoice = z.output<typeof choice>

export const taskBoardMoveSchema = z.discriminatedUnion('status', [
  // A moved card the phone cannot read still moved; null is the host's "applied, re-read failed".
  z.object({
    status: z.literal('moved'),
    card: salvagedField('card', taskBoardCardSchema.nullable(), () => null)
  }),
  z.object({ status: z.literal('needs-choice'), choices: salvagingArray(choice) }),
  z.object({ status: z.literal('needs-fields'), choice }),
  z.object({ status: z.literal('unsupported-fields'), choice }),
  z.object({
    status: z.literal('blocked'),
    reason: openEnum(['no-mapping', 'no-transition', 'same-column', 'invalid-choice'], 'no-mapping')
  }),
  z.object({ status: z.literal('failed'), error: z.string() })
])

export type MobileTaskBoardMoveResult = z.output<typeof taskBoardMoveSchema>

export const taskBoardAddCommentSchema: z.ZodType<TaskBoardAddCommentResult, unknown> =
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('added'), commentId: z.string() }),
    z.object({ status: z.literal('failed'), error: z.string() })
  ])

export const taskBoardSeenSchema = z.looseObject({})
