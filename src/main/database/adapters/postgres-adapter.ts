import Cursor from 'pg-cursor'
import { types, type QueryResult } from 'pg'
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
  const active = new Map<AbortController, Promise<void>>()
  let disposed = false
  const session: typeof withPostgresSession = async (config, credentials, signal, operation) => {
    if (disposed) {
      throw new Error('PostgreSQL adapter is closed')
    }
    const controller = new AbortController()
    let settled!: () => void
    active.set(
      controller,
      new Promise<void>((resolve) => {
        settled = resolve
      })
    )
    try {
      return await withPostgresSession(
        config,
        credentials,
        AbortSignal.any([signal, controller.signal, AbortSignal.timeout(config.limits.timeoutMs)]),
        operation
      )
    } finally {
      active.delete(controller)
      settled()
    }
  }
  return {
    preflight: (config, credentials, signal) =>
      session(config, credentials, signal, assertPostgresPrivilegeProfile),
    describe: (config, credentials, request, signal) =>
      session(config, credentials, signal, async (client) => {
        await assertPostgresPrivilegeProfile(client)
        return describePostgres(client, request)
      }),
    execute: (config, credentials, query, parameters, sink, signal) =>
      session(config, credentials, signal, async (client) => {
        if (query.engine !== 'postgres') {
          throw new Error('PostgreSQL query dialect mismatch')
        }
        await assertPostgresPrivilegeProfile(client)
        const values = bindPostgresParameters(parameters)
        const prepared = await preparePostgresResultQuery(client, query.sql, values)
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
            signal.throwIfAborted()
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
    dispose: async () => {
      disposed = true
      for (const controller of active.keys()) {
        controller.abort(new Error('PostgreSQL adapter disposed'))
      }
      await Promise.all(active.values())
    }
  }
}
