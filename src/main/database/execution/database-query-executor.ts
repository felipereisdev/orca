import type { ExecutionHostId } from '../../../shared/execution-host'
import type {
  DatabaseConnection,
  DatabaseEngine
} from '../../../shared/database/database-contracts'
import type {
  DatabaseParameter,
  DatabaseQueryRecord
} from '../../../shared/database/database-query-contracts'
import type { DatabaseAdapter, DatabaseResultSink } from '../adapters/database-adapter'
import type { DatabaseCredentialStore } from '../credentials/database-credential-store'
import type { DatabaseExecutableQuery } from '../query-policy/database-query-policy'

export type DatabaseLocalExecution = {
  credentials: Pick<DatabaseCredentialStore, 'read'>
  adapter(engine: DatabaseEngine): DatabaseAdapter | undefined
}
export type DatabaseRemoteExecution = (
  record: DatabaseQueryRecord,
  connection: DatabaseConnection,
  query: DatabaseExecutableQuery,
  parameters: DatabaseParameter[],
  output: DatabaseResultSink,
  signal: AbortSignal
) => Promise<void>
export async function executeLocalDatabaseQuery(
  options: DatabaseLocalExecution,
  connection: DatabaseConnection,
  query: DatabaseExecutableQuery,
  parameters: DatabaseParameter[],
  output: DatabaseResultSink,
  signal: AbortSignal
): Promise<void> {
  const credentials = await options.credentials.read(connection.credentialRef)
  const adapter = options.adapter(connection.engine)
  if (!adapter) {
    throw new Error('Database adapter is unavailable')
  }
  const profile = await adapter.preflight(connection, credentials, signal)
  if (connection.accessMode === 'read-write') {
    if (!adapter.executeStatement) {
      throw new Error('Database write execution is unavailable')
    }
    signal.throwIfAborted()
    await adapter.executeStatement(connection, credentials, query.sql, parameters, output, signal)
    return
  }
  if (!profile.readOnlyProfile || !('statementSql' in query)) {
    throw new Error('Database principal does not meet the read-only profile')
  }
  signal.throwIfAborted()
  await adapter.execute(connection, credentials, query, parameters, output, signal)
}

export function executeDatabaseQueryOnHost(
  options: DatabaseLocalExecution & {
    executionHostId: ExecutionHostId
    remoteExecution?: DatabaseRemoteExecution
  },
  record: DatabaseQueryRecord,
  connection: DatabaseConnection,
  query: DatabaseExecutableQuery,
  parameters: DatabaseParameter[],
  output: DatabaseResultSink,
  signal: AbortSignal
): Promise<void> {
  return connection.executionHostId !== options.executionHostId && options.remoteExecution
    ? options.remoteExecution(record, connection, query, parameters, output, signal)
    : executeLocalDatabaseQuery(options, connection, query, parameters, output, signal)
}
