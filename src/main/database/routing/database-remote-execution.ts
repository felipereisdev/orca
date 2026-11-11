import type { DatabaseConnection } from '../../../shared/database/database-contracts'
import type {
  DatabaseQueryRecord,
  DatabaseParameter
} from '../../../shared/database/database-query-contracts'
import { databaseQueryResultSchema } from '../../../shared/database/database-query-result-schema'
import type { ValidatedDatabaseReadQuery } from '../query-policy/database-query-policy'
import type { DatabaseResultSink } from '../adapters/database-adapter'
import type { DatabaseExecutionRouter } from './database-execution-route'

export async function executeRemoteDatabaseQuery(
  router: DatabaseExecutionRouter,
  record: DatabaseQueryRecord,
  connection: DatabaseConnection,
  query: ValidatedDatabaseReadQuery,
  parameters: DatabaseParameter[],
  output: DatabaseResultSink,
  signal: AbortSignal
): Promise<void> {
  const route = await router.resolveDatabaseExecutionRoute(
    { connectionId: connection.id, controllerRuntimeId: record.source.controllerRuntimeId },
    record.project,
    {
      controllerRuntimeId: record.source.controllerRuntimeId,
      project: record.project,
      sessionId: record.sessionId,
      owner: false
    }
  )
  signal.throwIfAborted()
  const scope = {
    credentialRef: connection.credentialRef,
    controllerRuntimeId: record.source.controllerRuntimeId,
    queryId: record.queryId,
    project: record.project,
    sessionId: record.sessionId
  }
  let finished = false
  let cancellation: Promise<unknown> | undefined
  const cancel = () => {
    cancellation ??= router.call(route, 'database.cancelBindingQuery', scope, 5000).catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await router.call(route, 'database.startBindingQuery', { ...scope, sql: query.sql, parameters })
    if (signal.aborted) {
      cancellation = undefined
      cancel()
      signal.throwIfAborted()
    }
    while (true) {
      signal.throwIfAborted()
      const raw = await router.call(route, 'database.waitBindingQuery', scope, 30000)
      if (Buffer.byteLength(JSON.stringify(raw)) > connection.limits.maxOutputBytes) {
        throw new Error('Remote database result exceeds its output budget')
      }
      const result = databaseQueryResultSchema.parse(raw)
      if (
        result.record.queryId !== record.queryId ||
        JSON.stringify(result.record.source) !== JSON.stringify(record.source)
      ) {
        throw new Error('Remote database execution provenance does not match')
      }
      if (result.status === 'queued' || result.status === 'running') {
        continue
      }
      if (result.status !== 'completed') {
        throw new Error('Remote database query did not complete')
      }
      if (
        result.rowCount !== result.rows.length ||
        result.rows.some((row) => row.length !== result.columns.length)
      ) {
        throw new Error('Remote database result shape is invalid')
      }
      output.columns(result.columns)
      for (const row of result.rows) {
        if (!output.row(row)) {
          break
        }
      }
      if (result.truncated) {
        output.markTruncated()
      }
      finished = true
      return
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    if (!finished) {
      cancellation = undefined
      cancel()
    }
    await cancellation
  }
}
