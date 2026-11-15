import { z } from 'zod'

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
