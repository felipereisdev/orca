import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOracleAdapter } from '../../src/main/database/adapters/oracle-adapter'
import { validateDatabaseReadQuery } from '../../src/main/database/query-policy/database-query-policy'
import type {
  DatabaseAdapter,
  DatabaseResultSink
} from '../../src/main/database/adapters/database-adapter'
import type { DatabaseParameter } from '../../src/shared/database/database-query-contracts'
import { captureDatabaseResult as capture } from './capture-database-result'
import { createOracleFixture } from './oracle-fixture'
let fixture: Awaited<ReturnType<typeof createOracleFixture>>
let adapter: DatabaseAdapter
beforeAll(async () => {
  fixture = await createOracleFixture()
  adapter = createOracleAdapter()
}, 240000)
afterAll(async () => {
  await adapter?.dispose()
  await fixture?.close()
})
async function execute(
  statement: string,
  sink: DatabaseResultSink,
  parameters: DatabaseParameter[] = [],
  signal = AbortSignal.timeout(10000)
) {
  await adapter.execute(
    fixture.configuration,
    fixture.credentials,
    validateDatabaseReadQuery('oracle', statement),
    parameters,
    sink,
    signal
  )
}
describe('Oracle Thin with a dedicated reader and verified TLS', () => {
  it('preserves NUMBER text, ordered duplicate columns, nulls and primary key metadata', async () => {
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
      'SELECT id AS value, amount AS value, memo FROM approved.invoices ORDER BY id DESC',
      result.sink
    )
    expect(result.names).toEqual(['VALUE', 'VALUE', 'MEMO'])
    expect(result.rows).toEqual([['9007199254740993', '123456789012345678901.123456789', null]])
    const schema = await adapter.describe(
      fixture.configuration,
      fixture.credentials,
      {
        connection: 'fixture-hmg',
        project: { kind: 'folder', projectId: 'fixture', executionHostId: 'local' },
        schema: 'APPROVED',
        table: 'INVOICES'
      },
      AbortSignal.timeout(10000)
    )
    expect(schema.columns).toContainEqual({
      name: 'ID',
      databaseType: 'NUMBER',
      nullable: false,
      primaryKey: true
    })
  })
  it('refuses writes, routines, privileged accounts and unverified certificates', async () => {
    for (const statement of [
      'DELETE FROM approved.invoices',
      'SELECT id FROM approved.invoices FOR UPDATE',
      'SELECT approved.sequence.NEXTVAL FROM dual',
      'BEGIN NULL; END;',
      'SELECT approved.side_effect() FROM dual'
    ]) {
      await expect(execute(statement, capture().sink)).rejects.toThrow()
    }
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
    await fixture.admin.execute('GRANT UPDATE ON approved.invoices TO orca_reader')
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await fixture.admin.execute('REVOKE UPDATE ON approved.invoices FROM orca_reader')
    }
    const result = capture()
    await execute('SELECT id FROM approved.invoices ORDER BY id', result.sink)
    expect(result.rows).toEqual([['2'], ['9007199254740993']])
  })
  it('refuses application views, virtual columns and publicly callable routines', async () => {
    await fixture.admin.execute(
      'CREATE VIEW approved.invoice_view AS SELECT id FROM approved.invoices'
    )
    await fixture.admin.execute('GRANT SELECT ON approved.invoice_view TO orca_reader')
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await fixture.admin.execute('DROP VIEW approved.invoice_view')
    }
    await fixture.admin.execute(
      'ALTER TABLE approved.invoices ADD calculated NUMBER GENERATED ALWAYS AS (id+1) VIRTUAL'
    )
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await fixture.admin.execute('ALTER TABLE approved.invoices DROP COLUMN calculated')
    }
    await fixture.admin.execute(
      'CREATE FUNCTION approved.side_effect RETURN NUMBER AUTHID DEFINER IS BEGIN RETURN 1; END;'
    )
    await fixture.admin.execute('GRANT EXECUTE ON approved.side_effect TO PUBLIC')
    try {
      await expect(
        adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
      ).rejects.toThrow()
    } finally {
      await fixture.admin.execute('DROP FUNCTION approved.side_effect')
    }
  })
  it('binds exact integer and decimal strings and bounds LOBs before the sink', async () => {
    const bound = capture()
    await execute(
      'SELECT :identifier AS value, :amount AS value, :empty AS empty_value FROM dual',
      bound.sink,
      [
        { name: 'identifier', type: 'integer', value: '9007199254740993' },
        { name: 'amount', type: 'decimal', value: '123456789012345678901.123456789' },
        { name: 'empty', type: 'string', value: null }
      ]
    )
    expect(bound.rows).toEqual([['9007199254740993', '123456789012345678901.123456789', null]])
    await expect(
      execute('SELECT :amount FROM dual', capture().sink, [
        {
          name: 'amount',
          type: 'decimal',
          value: '12345678901234567890123456789012345678901234567890'
        }
      ])
    ).rejects.toThrow()
    const large = capture()
    await execute('SELECT memo FROM approved.large_values', large.sink)
    expect(large.rows[0][0]).toBe('x'.repeat(4097))
  })
  it('confirms cancellation and deadline at the server and disposes active sessions', async () => {
    const statement =
      'SELECT COUNT(*) FROM approved.load a CROSS JOIN approved.load b CROSS JOIN approved.load c'
    const controller = new AbortController()
    const running = execute(statement, capture().sink, [], controller.signal)
    const stopped = expect(running).rejects.toThrow()
    await fixture.waitForExecutingReader()
    controller.abort(new Error('Cancelled by fixture'))
    await stopped
    expect(await fixture.activeReaders()).toBe(0)
    await expect(
      adapter.execute(
        { ...fixture.configuration, limits: { ...fixture.configuration.limits, timeoutMs: 1000 } },
        fixture.credentials,
        validateDatabaseReadQuery('oracle', statement),
        [],
        capture().sink,
        AbortSignal.timeout(10000)
      )
    ).rejects.toThrow()
    expect(await fixture.activeReaders()).toBe(0)
    const active = execute(statement, capture().sink)
    const disposed = expect(active).rejects.toThrow()
    await fixture.waitForExecutingReader()
    await adapter.dispose()
    await disposed
    expect(await fixture.activeReaders()).toBe(0)
    await expect(
      adapter.preflight(fixture.configuration, fixture.credentials, AbortSignal.timeout(10000))
    ).rejects.toThrow()
  })
})
