import { z } from 'zod'
import { databaseConnectionSchema } from '../../../src/shared/database/database-configuration-schema'
import { databaseQueryRecordSchema } from '../../../src/shared/database/database-query-result-schema'

export const mobileDatabaseConnectionsSchema = z.array(
  databaseConnectionSchema.omit({ endpoint: true, credentialRef: true })
)

export const mobileDatabaseQueryHandleSchema = databaseQueryRecordSchema.pick({
  queryId: true,
  source: true
})

export const mobileDatabaseSchemaResultSchema = z.object({
  schemas: z.array(z.string().max(256)).max(1000),
  tables: z
    .array(
      z.object({
        schema: z.string().max(256),
        name: z.string().max(256),
        kind: z.enum(['table', 'view'])
      })
    )
    .max(1000),
  columns: z
    .array(
      z.object({
        name: z.string().max(256),
        databaseType: z.string(),
        nullable: z.boolean(),
        primaryKey: z.boolean()
      })
    )
    .max(1000),
  truncated: z.boolean()
})
