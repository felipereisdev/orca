import { z } from 'zod'
import {
  databaseConnectionInputSchema,
  databaseConnectionId,
  databaseCredentialRef,
  databaseConnectionSchema,
  databaseProjectSchema
} from '../database/database-configuration-schema'

export const DatabaseParameters = z
  .array(
    z
      .object({
        name: z.string().min(1).max(256),
        type: z.enum(['string', 'integer', 'decimal', 'boolean', 'date', 'binary']),
        value: z.union([z.string().max(65536), z.boolean(), z.null()])
      })
      .superRefine((parameter, context) => {
        if (parameter.value === null) {
          return
        }
        const value = parameter.value
        const valid =
          parameter.type === 'boolean'
            ? typeof value === 'boolean'
            : typeof value === 'string' &&
              (parameter.type === 'integer'
                ? /^-?\d+$/.test(value)
                : parameter.type === 'decimal'
                  ? /^-?\d+(?:\.\d+)?$/.test(value)
                  : parameter.type === 'date'
                    ? Number.isFinite(Date.parse(value))
                    : parameter.type === 'binary'
                      ? /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                          value
                        )
                      : true)
        if (!valid) {
          context.addIssue({ code: 'custom', message: 'Invalid typed database parameter' })
        }
      })
  )
  .max(256)
  .superRefine((parameters, context) => {
    if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) {
      context.addIssue({ code: 'custom', message: 'Database parameter names must be unique' })
    }
  })

  .refine(
    (parameters) => new TextEncoder().encode(JSON.stringify(parameters)).length <= 262144,
    'Database parameters exceed their byte limit'
  )

export const DatabaseScope = z
  .object({
    project: z.string().min(1).max(1024).optional(),
    worktree: z.string().min(1).max(2048).optional()
  })
  .refine(
    (scope) => Boolean(scope.project) !== Boolean(scope.worktree),
    'Select one database project or workspace'
  )
export const DatabaseDescribe = DatabaseScope.safeExtend({
  connection: z.string().min(1).max(128),
  schema: z.string().max(256).optional(),
  table: z.string().max(256).optional()
})
export const DatabaseStartQuery = DatabaseScope.safeExtend({
  connection: z.string().min(1).max(128),
  sql: z.string().min(1).max(65536),
  parameters: DatabaseParameters
}).refine(
  (input) => new TextEncoder().encode(input.sql).length <= 65536,
  'SQL exceeds its byte limit'
)
export const DatabaseQueryId = DatabaseScope.safeExtend({ queryId: z.string().uuid() })
export const DatabaseSave = z.object({
  configuration: databaseConnectionInputSchema,
  credentials: z
    .object({ username: z.string().min(1).max(256), password: z.string().min(1).max(8192) })
    .optional(),
  expectedRevision: z.number().int().positive().optional()
})
export const DatabaseConfigurationId = z.object({ connectionId: databaseConnectionId })
export const DatabaseRemove = DatabaseConfigurationId.extend({
  expectedRevision: z.number().int().positive()
})

export const DatabaseBindingRef = z.object({
  credentialRef: databaseCredentialRef,
  controllerRuntimeId: z.string().min(1).max(1024)
})
export const DatabaseBindingEnroll = z.object({
  controllerRuntimeId: z.string().min(1).max(1024),
  configuration: databaseConnectionSchema,
  credentials: DatabaseSave.shape.credentials,
  previousCredentialRef: databaseCredentialRef.optional()
})
export const DatabaseBindingDescribe = DatabaseBindingRef.extend({
  project: databaseProjectSchema,
  schema: z.string().max(256).optional(),
  table: z.string().max(256).optional()
})
export const DatabaseBindingQuery = DatabaseBindingRef.extend({
  project: databaseProjectSchema,
  sessionId: z.string().min(1).max(1024),
  queryId: z.string().uuid()
})
export const DatabaseBindingStart = DatabaseBindingQuery.extend({
  sql: z.string().min(1).max(65536),
  parameters: DatabaseParameters
})
