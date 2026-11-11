import type { DatabaseConnection } from '../../../shared/database/database-contracts'
import type {
  DatabaseQueryInput,
  DatabaseQueryRecord
} from '../../../shared/database/database-query-contracts'
import type { DatabaseActor } from './database-query-actor'
import type { DatabaseQueryJob } from './database-query-admission'

export function createDatabaseQueryJob(
  input: DatabaseQueryInput,
  actor: DatabaseActor,
  connection: DatabaseConnection,
  queryId: string
): { job: DatabaseQueryJob; settle: () => void } {
  const record: DatabaseQueryRecord = {
    queryId,
    source: {
      connectionId: connection.id,
      connectionRevision: connection.revision,
      alias: connection.alias,
      engine: connection.engine,
      environment: connection.environment,
      executionHostId: connection.executionHostId,
      controllerRuntimeId: actor.controllerRuntimeId
    },
    project: structuredClone(actor.project),
    sessionId: actor.sessionId,
    sql: input.sql,
    parameterNames: input.parameters.map((parameter) => parameter.name),
    createdAt: Date.now(),
    finishedAt: null,
    status: 'queued',
    rowCount: 0,
    truncated: false
  }
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('Database query deadline exceeded')),
    connection.limits.timeoutMs
  )
  timer.unref?.()
  let settle!: () => void
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const job: DatabaseQueryJob = {
    record,
    connection,
    controller,
    timer,
    settled
  }
  return { job, settle }
}
