import type { ValidatedDatabaseReadQuery } from '@orca/sql-read-query-parser/read-query'
import type {
  DatabaseConnection,
  DatabaseEngine
} from '../../../shared/database/database-contracts'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
import { validateDatabaseReadQueryInWorker } from './database-query-policy-worker'
export {
  validateDatabaseReadQuery,
  type ValidatedDatabaseReadQuery
} from '@orca/sql-read-query-parser/read-query'

export type DatabaseExecutableQuery =
  | ValidatedDatabaseReadQuery
  | {
      readonly engine: DatabaseEngine
      readonly sql: string
      readonly accessMode: 'read-write'
    }

export async function validateDatabaseQueryForConnection(
  connection: DatabaseConnection,
  sql: string,
  parameters: DatabaseParameter[],
  signal: AbortSignal
): Promise<DatabaseExecutableQuery> {
  if (connection.accessMode === 'read-write') {
    return { engine: connection.engine, sql, accessMode: 'read-write' }
  }
  const query = await validateDatabaseReadQueryInWorker(connection.engine, sql, signal)
  if (
    query.parameterNames.some((name) => !parameters.some((parameter) => parameter.name === name))
  ) {
    throw new Error('Database query parameters are missing')
  }
  return query
}
