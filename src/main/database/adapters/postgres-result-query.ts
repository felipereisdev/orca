import { parseSql } from '@orca/sql-read-query-parser'
import type { Client } from 'pg'
import type { DatabaseColumn } from '../../../shared/database/database-query-contracts'

export async function preparePostgresResultQuery(
  client: Client,
  sql: string,
  values: unknown[]
): Promise<{
  sql: string
  columns: DatabaseColumn[]
}> {
  const tokens = parseSql('postgres', sql).tokens
  if (tokens.at(-1)?.text === ';') {
    tokens.pop()
  }
  const statement = tokens.map((token) => token.text).join(' ')
  const description = await client.query({
    text: `SELECT * FROM (${statement}) AS _orca_description LIMIT 0`,
    values,
    rowMode: 'array'
  })
  if (!description.fields.length || description.fields.length > 256) {
    throw new Error('PostgreSQL result columns exceed the supported limit')
  }
  const types = await client.query<{ oid: number; name: string }>(
    'SELECT oid, typname AS name FROM pg_catalog.pg_type WHERE oid = ANY($1)',
    [description.fields.map((field) => field.dataTypeID)]
  )
  const names = new Map(types.rows.map((row) => [row.oid, row.name]))
  const aliases = description.fields.map((_field, index) => `c${index}`)
  const projections = description.fields.map((field, index) => {
    const column = `_orca_row.c${index}`
    if (field.dataTypeID === 16) {
      return column
    }
    if (field.dataTypeID === 17) {
      return `pg_catalog.substring(${column}, 1, 3073)`
    }
    return `pg_catalog.left(${column}::pg_catalog.text, 4097)`
  })
  return {
    sql: `SELECT ${projections.join(', ')} FROM (${statement}) AS _orca_row(${aliases.join(', ')})`,
    columns: description.fields.map((field, index) => ({
      id: String(index),
      name: field.name,
      databaseType: names.get(field.dataTypeID) ?? String(field.dataTypeID)
    }))
  }
}
