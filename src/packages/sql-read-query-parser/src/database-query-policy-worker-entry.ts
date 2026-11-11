import { parentPort } from 'node:worker_threads'
import { validateDatabaseReadQuery } from './database-query-policy'
import type { SqlEngine } from './parse-sql'
parentPort?.on('message', (request: { id: number; engine: SqlEngine; sql: string }) => {
  try {
    parentPort?.postMessage({
      id: request.id,
      ok: true,
      query: validateDatabaseReadQuery(request.engine, request.sql)
    })
  } catch {
    parentPort?.postMessage({ id: request.id, ok: false })
  }
})
