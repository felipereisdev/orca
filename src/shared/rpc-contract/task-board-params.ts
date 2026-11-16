import { z } from 'zod'
import { isTuiAgent } from '../agent-launch/catalog/tui-agent-config'
import type { TuiAgent } from '../agent-launch/catalog/tui-agent'

const Str = (max: number) => z.string().min(1).max(max)
const Id = Str(512)

export const TaskBoardCardRefParam = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('jira'), siteId: Id.nullable(), key: Id }),
  z.strictObject({
    provider: z.literal('linear'),
    workspaceId: Id.nullable(),
    id: Id,
    teamId: Id
  }),
  z.strictObject({
    provider: z.literal('gitlab'),
    repoId: Id,
    number: z.number().int().positive(),
    projectRef: z.strictObject({ host: Id, path: Str(2048) }).nullable()
  }),
  z.strictObject({
    provider: z.literal('github'),
    repoId: Id,
    number: z.number().int().positive(),
    issueRepo: z.strictObject({ owner: Id, repo: Id }).nullable()
  })
])

export const TaskBoardListParams = z.strictObject({ fresh: z.boolean().optional() })

export const TaskBoardDetailParams = z.strictObject({ ref: TaskBoardCardRefParam })

export const TaskBoardAddCommentParams = z.strictObject({
  ref: TaskBoardCardRefParam,
  body: Str(20000)
})

export const TaskBoardMarkSeenParams = z.strictObject({
  ref: TaskBoardCardRefParam,
  at: Str(64),
  id: Id
})

export const TaskBoardMoveFieldsParam = z.strictObject({
  resolutionId: Id.optional(),
  comment: Str(20000).optional()
})

export const TaskBoardMoveParams = z.strictObject({
  ref: TaskBoardCardRefParam,
  targetColumnId: Id,
  choiceId: Id.optional(),
  fields: TaskBoardMoveFieldsParam.optional()
})

// Without ref (the settings screens) only an explicit repoId or the repo list is answered.
export const TaskBoardStartOptionsParams = z.strictObject({
  ref: TaskBoardCardRefParam.optional(),
  repoId: Id.optional()
})

const TaskStartAgentChoiceParam = z.strictObject({
  agent: z.custom<TuiAgent>(isTuiAgent, { message: 'Unknown TUI agent' }),
  accountId: Id.optional(),
  model: Str(200).optional(),
  effort: Str(200).optional()
})

// Each role overrides the repo/global choice for this start only ("Iniciar como…").
export const TaskBoardStartTaskParams = z.strictObject({
  ref: TaskBoardCardRefParam,
  repoId: Id.optional(),
  workspaceMode: z.enum(['worktree', 'primary']).optional(),
  baseRef: Str(512).optional(),
  roles: z
    .strictObject({
      orchestrator: TaskStartAgentChoiceParam.optional(),
      planner: TaskStartAgentChoiceParam.optional(),
      planReviewer: TaskStartAgentChoiceParam.optional(),
      implementer: TaskStartAgentChoiceParam.optional(),
      reviewer: TaskStartAgentChoiceParam.optional(),
      qa: TaskStartAgentChoiceParam.optional()
    })
    .optional(),
  confirmPrimary: z.boolean().optional(),
  /** Extra instructions typed in "Start as…", for this start only. */
  userPrompt: Str(8000).optional()
})

// `preview` only counts the agents a stop would end, for the confirmation; `force` lets a run
// whose stop stays unconfirmed go after one more attempt ("Forget run").
export const TaskBoardStopTaskParams = z.strictObject({
  ref: TaskBoardCardRefParam,
  preview: z.boolean().optional(),
  force: z.boolean().optional()
})

// The caller's own session names the run; `starting` is Orca's alone to report.
export const OrchestrationTaskStartPhaseParams = z.strictObject({
  phase: z.enum([
    'planning',
    'plan-review',
    'qa-script',
    'development',
    'final-review',
    'qa',
    'completed',
    'waiting'
  ]),
  current: z.number().int().nonnegative().optional(),
  total: z.number().int().positive().optional(),
  step: z.enum(['implementing', 'reviewing']).optional(),
  note: Str(2000).optional()
})
