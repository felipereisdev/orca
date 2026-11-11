import { executePostgresStatement } from './postgres-statement'
import { createDatabaseAdapterSessions } from './database-adapter-sessions'
import Cursor from 'pg-cursor'
import { types, type QueryResult, type Client } from 'pg'
import { bindPostgresParameters } from './postgres-parameters'
import type { DatabaseAdapter } from './database-adapter'
import { assertPostgresPrivilegeProfile } from './postgres-privilege-profile'
import { describePostgres } from './postgres-schema'
import { withPostgresSession } from './postgres-session'
import { preparePostgresResultQuery } from './postgres-result-query'

export function createPostgresAdapter(): DatabaseAdapter {
  const sessions = createDatabaseAdapterSessions<Client>(withPostgresSession)
  const session = sessions.run
  return {
    executeStatement: (config, credentials, statement, parameters, sink, signal) => {
      if (config.accessMode !== 'read-write') {
        return Promise.reject(new Error('Database write access is disabled'))
      }
      return session(config, credentials, signal, (client) =>
        executePostgresStatement(client, statement, parameters, sink, config.limits)
      )
    },
    preflight: (config, credentials, signal) =>
      session(config, credentials, signal, async (client, activeSignal) =>
        config.accessMode === 'read-write'
          ? {
              serverVersion:
                (
                  await client.query<{ version: string }>(
                    "SELECT current_setting('server_version') AS version"
                  )
                ).rows[0].version ?? 'PostgreSQL',
              readOnlyProfile: false
            }
          : assertPostgresPrivilegeProfile(client, activeSignal)
      ),
    describe: (config, credentials, request, signal) =>
      session(config, credentials, signal, async (client, activeSignal) => {
        if (config.accessMode !== 'read-write') {
          await assertPostgresPrivilegeProfile(client, activeSignal)
        }
        return describePostgres(client, request)
      }),
    execute: (config, credentials, query, parameters, sink, signal) =>
      session(config, credentials, signal, async (client, activeSignal) => {
        if (query.engine !== 'postgres') {
          throw new Error('PostgreSQL query dialect mismatch')
        }
        if (config.accessMode !== 'read-write') {
          await assertPostgresPrivilegeProfile(client, activeSignal)
        }
        const values = bindPostgresParameters(parameters)
        const prepared = await preparePostgresResultQuery(client, query.statementSql, values)
        sink.columns(prepared.columns)
        const cursor = client.query(
          new Cursor(prepared.sql, values, {
            rowMode: 'array',
            types: {
              getTypeParser: (oid) =>
                oid === 16
                  ? (value: string) => value === 't'
                  : oid === 17
                    ? types.getTypeParser(oid)
                    : (value: string) => value
            }
          })
        )
        try {
          while (!sink.stopped) {
            activeSignal.throwIfAborted()
            const batch = await new Promise<QueryResult<unknown[]>>((resolve, reject) => {
              cursor.read(1, (error, _rows, result) => (error ? reject(error) : resolve(result)))
            })
            if (!batch.rows.length || !sink.row(batch.rows[0])) {
              break
            }
          }
        } finally {
          await cursor.close().catch(() => {})
        }
      }),
    dispose: sessions.dispose
  }
}
