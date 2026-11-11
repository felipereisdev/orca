import { z } from 'zod'
import { databaseProjectSchema, databaseLimitsSchema } from './database-configuration-schema'

const source = z.object({
  connectionId: z.string().uuid(),
  connectionRevision: z.number().int().positive(),
  alias: z.string().max(96),
  engine: z.enum(['postgres', 'sql-server', 'oracle']),
  environment: z.string().max(80),
  executionHostId: databaseProjectSchema.shape.executionHostId,
  controllerRuntimeId: z.string().min(1).max(1024)
})
const record = z.object({
  queryId: z.string().uuid(),
  source,
  project: databaseProjectSchema,
  sessionId: z.string().max(2048),
  sql: z.string().max(65536),
  parameterNames: z.array(z.string().max(256)).max(256),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  rowCount: z.number().int().min(0).max(1000),
  truncated: z.boolean(),
  error: z.object({ code: z.string().max(128), message: z.string().max(1024) }).optional()
})
const cell = z.union([
  z.string().max(4096),
  z.boolean(),
  z.null(),
  z.object({ kind: z.literal('preview'), text: z.string().max(4096), truncated: z.literal(true) })
])
export const databaseQueryResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['queued', 'running']), record }),
  z.object({
    status: z.literal('completed'),
    record,
    columns: z
      .array(
        z.object({
          id: z.string().max(256),
          name: z.string().max(256),
          databaseType: z.string().max(128)
        })
      )
      .max(256),
    rows: z.array(z.array(cell).max(256)).max(1000),
    rowCount: z.number().int().min(0).max(1000),
    truncated: z.boolean(),
    limits: databaseLimitsSchema
  }),
  z.object({ status: z.enum(['failed', 'cancelled', 'expired']), record })
])
