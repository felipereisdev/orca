import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSqlServerAdapter } from '../../src/main/database/adapters/sql-server-adapter'
import type {
  DatabaseAdapter,
  DatabaseResultSink
} from '../../src/main/database/adapters/database-adapter'
import type { DatabaseParameter } from '../../src/shared/database/database-query-contracts'
import { validateDatabaseReadQuery } from '../../src/main/database/query-policy/database-query-policy'
import { captureDatabaseResult as capture } from './capture-database-result'
import { createSqlServerFixture } from './sql-server-fixture'
let fixture: Awaited<ReturnType<typeof createSqlServerFixture>>
let adapter: DatabaseAdapter
beforeAll(async () => {
  fixture = await createSqlServerFixture()
  adapter = createSqlServerAdapter()
}, 120000)
afterAll(async () => {
  await adapter?.dispose()
  await fixture?.close()
})
async function execute(
  sql: string,
  sink: DatabaseResultSink,
  parameters: DatabaseParameter[] = [],
  signal = AbortSignal.timeout(10000)
) {
  return adapter.execute(
    fixture.configuration,
    fixture.credentials,
    validateDatabaseReadQuery('sql-server', sql),
    parameters,
    sink,
    signal
  )
}
describe('SQL Server with a dedicated reader and verified TLS', () => {
  it('preserves exact numbers, duplicate names and nulls and describes primary keys', async () => {
    expect(
      (
        await adapter.preflight(
          fixture.configuration,
          fixture.credentials,
          AbortSignal.timeout(10000)
        )
      ).readOnlyProfile
    ).toBe(true)
    const result = capture(1)
    await execute(
      'SELECT TOP (10) id AS value, amount AS value, memo FROM approved.invoices ORDER BY id DESC',
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
      AbortSignal.timeout(10000)
    )
    expect(schema.columns).toContainEqual({
      name: 'id',
      databaseType: 'bigint',
      nullable: false,
      primaryKey: true
    })
  })
  it('refuses mutations, unsafe paths, administrators, writable grants and unverified certificates', async () => {
    for (const sql of [
      'SELECT * INTO approved.copy FROM approved.invoices',
      'SELECT 1; DELETE FROM approved.invoices',
      'SELECT approved.side_effect()',
      'SELECT * FROM approved.invoices WITH (UPDLOCK)',
      'SELECT * FROM other.fixture.approved.invoices'
    ]) {
      await expect(execute(sql, capture().sink)).rejects.toThrow()
    }
    await expect(fixture.reader('DELETE FROM approved.invoices')).rejects.toThrow()
    await expect(
      adapter.preflight(fixture.configuration, fixture.adminCredentials, AbortSignal.timeout(10000))
    ).rejects.toThrow()
    await expect(
      adapter.preflight(
        {
          ...fixture.configuration,
          endpoint: { ...fixture.configuration.endpoint, tls: { enabled: true } }
        },
        fixture.credentials,
        AbortSignal.timeout(10000)
      )
    ).rejects.toThrow()
    await fixture.admin('GRANT UPDATE ON approved.invoices TO orca_reader')
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await fixture.admin('REVOKE UPDATE ON approved.invoices FROM orca_reader')
    }
    expect(
      (await fixture.admin('SELECT id FROM approved.invoices ORDER BY id')).recordset.map(
        (row: { id: string }) => row.id
      )
    ).toEqual(['2', '9007199254740993'])
  })
  it('refuses indirect sources that the initial profile cannot certify', async () => {
    await fixture.admin('CREATE VIEW approved.invoice_view AS SELECT id FROM approved.invoices')
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await fixture.admin('DROP VIEW approved.invoice_view')
    }
    await fixture.admin('ALTER TABLE approved.invoices ADD calculated AS id + 1')
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await fixture.admin('ALTER TABLE approved.invoices DROP COLUMN calculated')
    }
  })
  it('refuses computed sources exposed only through a column grant', async () => {
    await fixture.admin('REVOKE SELECT ON SCHEMA::approved FROM orca_reader')
    await fixture.admin('CREATE FUNCTION approved.hidden() RETURNS int AS BEGIN RETURN 42 END')
    await fixture.admin(
      'CREATE TABLE approved.computed_only (base int, derived AS approved.hidden()); INSERT INTO approved.computed_only(base) VALUES (1); GRANT SELECT (derived) ON OBJECT::approved.computed_only TO orca_reader'
    )
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
      await expect(
        execute('SELECT derived FROM approved.computed_only', capture().sink)
      ).rejects.toThrow()
    } finally {
      await fixture.admin(
        'DROP TABLE approved.computed_only; DROP FUNCTION approved.hidden; GRANT SELECT ON SCHEMA::approved TO orca_reader'
      )
    }
  })
  it('browses table and column grants without exposing unauthorized columns', async () => {
    await fixture.admin(
      'REVOKE SELECT ON SCHEMA::approved FROM orca_reader; GRANT SELECT ON OBJECT::approved.invoices TO orca_reader'
    )
    const request = {
      connection: 'fixture-hmg',
      project: { kind: 'folder' as const, projectId: 'fixture', executionHostId: 'local' as const },
      schema: 'approved',
      table: 'invoices'
    }
    try {
      expect(
        (
          await adapter.preflight(
            fixture.configuration,
            fixture.credentials,
            AbortSignal.timeout(10000)
          )
        ).readOnlyProfile
      ).toBe(true)
      const tableGrant = await adapter.describe(
        fixture.configuration,
        fixture.credentials,
        request,
        AbortSignal.timeout(10000)
      )
      expect(tableGrant.schemas).toEqual(['approved'])
      expect(tableGrant.tables).toEqual([{ schema: 'approved', name: 'invoices', kind: 'table' }])
      await fixture.admin(
        'REVOKE SELECT ON OBJECT::approved.invoices FROM orca_reader; GRANT SELECT (id) ON OBJECT::approved.invoices TO orca_reader'
      )
      const columnGrant = await adapter.describe(
        fixture.configuration,
        fixture.credentials,
        request,
        AbortSignal.timeout(10000)
      )
      expect(columnGrant.schemas).toEqual(['approved'])
      expect(columnGrant.tables).toEqual([{ schema: 'approved', name: 'invoices', kind: 'table' }])
      expect(columnGrant.columns).toEqual([
        { name: 'id', databaseType: 'bigint', nullable: false, primaryKey: true }
      ])
    } finally {
      await fixture.admin(
        'REVOKE SELECT (id) ON OBJECT::approved.invoices FROM orca_reader; REVOKE SELECT ON OBJECT::approved.invoices FROM orca_reader; GRANT SELECT ON SCHEMA::approved TO orca_reader'
      )
    }
  })
  it('binds integer and decimal strings without rounding them before SQL Server', async () => {
    const result = capture()
    await execute(
      'SELECT @identifier AS value, @amount AS value, @empty AS empty_value',
      result.sink,
      [
        { name: 'identifier', type: 'integer', value: '9007199254740993' },
        { name: 'amount', type: 'decimal', value: '123456789012345678901.123456789' },
        { name: 'empty', type: 'string', value: null }
      ]
    )
    expect(result.rows).toEqual([['9007199254740993', '123456789012345678901.123456789', null]])
  })
  it('bounds multi-megabyte values before the driver hands them to the result sink', async () => {
    const result = capture()
    await execute('SELECT memo FROM approved.large_values', result.sink)
    const value = result.rows[0][0]
    if (typeof value !== 'string') {
      throw new Error('Expected bounded text')
    }
    expect(Buffer.byteLength(value)).toBeLessThanOrEqual(8194)
  })
  it('confirms cancellation at the server and disposes active sessions', async () => {
    const release = await fixture.lock()
    const controller = new AbortController()
    try {
      const running = execute(
        'SELECT id FROM approved.blocked',
        capture().sink,
        [],
        controller.signal
      )
      const stopped = expect(running).rejects.toThrow()
      await fixture.waitForBlockedReader()
      controller.abort(new Error('Cancelled by fixture'))
      await stopped
      expect(await fixture.activeReaders()).toBe(0)
    } finally {
      await release()
    }
    const releaseTimeout = await fixture.lock()
    try {
      const running = adapter.execute(
        { ...fixture.configuration, limits: { ...fixture.configuration.limits, timeoutMs: 1000 } },
        fixture.credentials,
        validateDatabaseReadQuery('sql-server', 'SELECT id FROM approved.blocked'),
        [],
        capture().sink,
        AbortSignal.timeout(10000)
      )
      await expect(running).rejects.toThrow()
      expect(await fixture.activeReaders()).toBe(0)
    } finally {
      await releaseTimeout()
    }
    const releaseAgain = await fixture.lock()
    try {
      const running = execute('SELECT id FROM approved.blocked', capture().sink)
      const stopped = expect(running).rejects.toThrow()
      await fixture.waitForBlockedReader()
      await adapter.dispose()
      await stopped
      expect(await fixture.activeReaders()).toBe(0)
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await releaseAgain()
    }
  })
})
