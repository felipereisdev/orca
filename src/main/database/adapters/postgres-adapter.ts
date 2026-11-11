import { createDatabaseAdapterSessions } from './database-adapter-sessions'
import Cursor from 'pg-cursor'
import { types, type QueryResult, type Client } from 'pg'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
import type { DatabaseAdapter } from './database-adapter'
import { assertPostgresPrivilegeProfile } from './postgres-privilege-profile'
import { describePostgres } from './postgres-schema'
import { withPostgresSession } from './postgres-session'
import { preparePostgresResultQuery } from './postgres-result-query'

function bindPostgresParameters(parameters: DatabaseParameter[]): unknown[] {
  const positions = new Map<number, unknown>()
  for (const parameter of parameters) {
    const position = Number(parameter.name)
    if (
      !Number.isSafeInteger(position) ||
      position < 1 ||
      position > 256 ||
      positions.has(position)
    ) {
      throw new Error('PostgreSQL parameters require unique numeric positions')
    }
    positions.set(
      position,
      parameter.type === 'binary' && typeof parameter.value === 'string'
        ? Buffer.from(parameter.value, 'base64')
        : parameter.value
    )
  }
  const values: unknown[] = []
  for (let index = 1; index <= positions.size; index++) {
    if (!positions.has(index)) {
      throw new Error('PostgreSQL parameter positions must be contiguous')
    }
    values.push(positions.get(index))
  }
  return values
}

export function createPostgresAdapter(): DatabaseAdapter {
  const sessions = createDatabaseAdapterSessions<Client>(withPostgresSession)
  const session = sessions.run
  return {
    preflight: (config, credentials, signal) =>
      session(config, credentials, signal, assertPostgresPrivilegeProfile),
    describe: (config, credentials, request, signal) =>
      session(config, credentials, signal, async (client, activeSignal) => {
        await assertPostgresPrivilegeProfile(client, activeSignal)
        return describePostgres(client, request)
      }),
    execute: (config, credentials, query, parameters, sink, signal) =>
      session(config, credentials, signal, async (client, activeSignal) => {
        if (query.engine !== 'postgres') {
          throw new Error('PostgreSQL query dialect mismatch')
        }
        await assertPostgresPrivilegeProfile(client, activeSignal)
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
