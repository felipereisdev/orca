import { describe, expect, it } from 'vitest'
import { encodeDatabaseRow } from './database-result-encoding'
import { buildDatabaseTablePreview } from '../adapters/database-adapter'

describe('database result transport', () => {
  it('preserves an already truncated remote cell as a typed preview', () => {
    expect(
      encodeDatabaseRow(
        [{ id: '0', name: 'memo', databaseType: 'text' }],
        [{ kind: 'preview', text: 'partial memo', truncated: true }],
        4096
      ).row
    ).toEqual([{ kind: 'preview', text: 'partial memo', truncated: true }])
  })
  it('preserves exact numbers, duplicate columns, nulls and empty text', () => {
    const result = encodeDatabaseRow(
      [
        { id: '0', name: 'id', databaseType: 'int8' },
        { id: '1', name: 'id', databaseType: 'numeric' },
        { id: '2', name: 'optional', databaseType: 'text' },
        { id: '3', name: 'empty', databaseType: 'text' }
      ],
      [9007199254740993n, '1234567890.123456789', null, ''],
      4096
    )
    expect(result.row).toEqual(['9007199254740993', '1234567890.123456789', null, ''])
    expect(result.accepted).toBe(true)
    expect(result.truncated).toBe(false)
  })

  it('returns a bounded typed preview instead of an oversized text value', () => {
    const result = encodeDatabaseRow(
      [{ id: '0', name: 'content', databaseType: 'text' }],
      ['😀'.repeat(10_000)],
      256
    )
    expect(result.accepted).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.row[0]).toMatchObject({ kind: 'preview', truncated: true })
    expect(Buffer.byteLength(JSON.stringify(result.row))).toBeLessThanOrEqual(256)
  })

  it('refuses a numeric value whose precision was already lost by its driver', () => {
    expect(() =>
      encodeDatabaseRow([{ id: '0', name: 'id', databaseType: 'int8' }], [9007199254740992], 1024)
    ).toThrow()
  })

  it.each([
    ['postgres', 'SELECT * FROM "public"."odd""name" LIMIT 100'],
    ['sql-server', 'SELECT TOP (100) * FROM [public].[odd"name]'],
    ['oracle', 'SELECT * FROM "public"."odd""name" FETCH FIRST 100 ROWS ONLY']
  ] as const)('quotes discovered identifiers for a %s table preview', (engine, sql) => {
    expect(
      buildDatabaseTablePreview(engine, { schema: 'public', name: 'odd"name', kind: 'table' }, 100)
    ).toBe(sql)
  })
})
