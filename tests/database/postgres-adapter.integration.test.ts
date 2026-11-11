import { captureDatabaseResult as capture } from './capture-database-result'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresAdapter } from '../../src/main/database/adapters/postgres-adapter'
import type {
  DatabaseAdapter,
  DatabaseResultSink
} from '../../src/main/database/adapters/database-adapter'
import { validateDatabaseReadQuery } from '../../src/main/database/query-policy/database-query-policy'
import { createPostgresFixture } from './postgres-fixture'

let fixture: Awaited<ReturnType<typeof createPostgresFixture>>
let adapter: DatabaseAdapter
beforeAll(async () => {
  fixture = await createPostgresFixture()
  adapter = createPostgresAdapter()
})
afterAll(async () => {
  await adapter?.dispose()
  await fixture?.close()
})

async function execute(sql: string, sink: DatabaseResultSink, signal = AbortSignal.timeout(5000)) {
  return adapter.execute(
    fixture.configuration,
    fixture.credentials,
    validateDatabaseReadQuery('postgres', sql),
    [],
    sink,
    signal
  )
}

describe('PostgreSQL read-only adapter with verified TLS', () => {
  it('preserves exact seeded numbers, duplicate columns and nulls with bounded cursor reads', async () => {
    expect(
      (
        await adapter.preflight(
          fixture.configuration,
          fixture.credentials,
          AbortSignal.timeout(5000)
        )
      ).readOnlyProfile
    ).toBe(true)
    const result = capture(1)
    await execute(
      'SELECT id AS value, amount AS value, memo FROM approved.invoices ORDER BY id DESC',
      result.sink
    )
    expect(result.names).toEqual(['value', 'value', 'memo'])
    expect(result.rows).toEqual([['9007199254740993', '123456789012345678901.123456789', null]])
    const schema = await adapter.describe(
      fixture.configuration,
      fixture.credentials,
      {
        connection: 'fixture-hmg',
        project: { kind: 'folder', projectId: 'fixture', executionHostId: 'local' },
        schema: 'approved',
        table: 'invoices'
      },
      AbortSignal.timeout(5000)
    )
    expect(schema.columns).toContainEqual({
      name: 'id',
      databaseType: 'bigint',
      nullable: false,
      primaryKey: true
    })
  })

  it('refuses writes, side-effect routines, privileged accounts and unverified TLS', async () => {
    for (const sql of [
      'DELETE FROM approved.invoices',
      'WITH changed AS (DELETE FROM approved.invoices RETURNING *) SELECT * FROM changed',
      'SELECT approved.side_effect()',
      'SELECT 1; DELETE FROM approved.invoices'
    ]) {
      await expect(execute(sql, capture().sink)).rejects.toThrow()
    }
    await expect(
      adapter.preflight(
        fixture.configuration,
        { username: 'postgres', password: 'disposable-admin-password' },
        AbortSignal.timeout(5000)
      )
    ).rejects.toThrow()
    await expect(
      adapter.preflight(
        {
          ...fixture.configuration,
          endpoint: {
            ...fixture.configuration.endpoint,
            tls: { enabled: true }
          }
        },
        fixture.credentials,
        AbortSignal.timeout(5000)
      )
    ).rejects.toThrow()
    expect((await fixture.admin.query('SELECT count(*) FROM approved.invoices')).rows).toEqual([
      { count: '2' }
    ])
    expect((await fixture.admin.query('SELECT count(*) FROM approved.effects')).rows).toEqual([
      { count: '0' }
    ])
  })

  it('binds parameters and supports inspected invoker views while refusing newly granted write rights', async () => {
    const result = capture()
    await adapter.execute(
      fixture.configuration,
      fixture.credentials,
      validateDatabaseReadQuery(
        'postgres',
        'SELECT amount FROM approved.invoice_totals WHERE id = $1'
      ),
      [{ name: '1', type: 'integer', value: '9007199254740993' }],
      result.sink,
      AbortSignal.timeout(5000)
    )
    expect(result.rows).toEqual([['123456789012345678901.123456789']])
    await fixture.admin.query('GRANT UPDATE ON approved.invoices TO orca_reader')
    try {
      await expect(execute('SELECT * FROM approved.invoices', capture().sink)).rejects.toThrow()
    } finally {
      await fixture.admin.query('REVOKE UPDATE ON approved.invoices FROM orca_reader')
    }
  })

  it('bounds large cell values before the driver delivers them to the result sink', async () => {
    await fixture.admin.query(
      "UPDATE approved.invoices SET memo = repeat('x', 2000000) WHERE id = 2"
    )
    try {
      const result = capture()
      await execute('SELECT memo FROM approved.invoices WHERE id = 2;', result.sink)
      const value = result.rows[0][0]
      if (typeof value !== 'string') {
        throw new Error('Expected bounded text')
      }
      expect(Buffer.byteLength(value)).toBeLessThanOrEqual(16388)
    } finally {
      await fixture.admin.query("UPDATE approved.invoices SET memo = '' WHERE id = 2")
    }
  })

  it('cancels a server-blocked read and leaves no running server request', async () => {
    await fixture.admin.query('BEGIN; LOCK TABLE approved.blocked IN ACCESS EXCLUSIVE MODE')
    const controller = new AbortController()
    const result = capture()
    const running = execute('SELECT * FROM approved.blocked', result.sink, controller.signal)
    const outcome = running.then(
      () => 'completed',
      () => 'rejected'
    )
    try {
      await expect
        .poll(async () => {
          await fixture.admin.query('SELECT pg_stat_clear_snapshot()')
          return (
            await fixture.admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE usename = 'orca_reader' AND wait_event_type = 'Lock'"
            )
          ).rows[0].count
        })
        .toBe('1')
      controller.abort(new Error('Cancelled by fixture'))
      expect(await outcome).toBe('rejected')
    } finally {
      controller.abort()
      await fixture.admin.query('ROLLBACK')
      await outcome
    }
    await expect
      .poll(
        async () =>
          (
            await fixture.admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE usename = 'orca_reader' AND state = 'active'"
            )
          ).rows[0].count
      )
      .toBe('0')
    expect(result.rows).toEqual([])
  })
})
