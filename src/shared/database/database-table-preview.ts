import type { DatabaseEngine, DatabaseTable } from './database-contracts'

export function quoteDatabaseIdentifier(engine: DatabaseEngine, parts: readonly string[]): string {
  if (!parts.length || parts.some((part) => !part || part.length > 256 || part.includes('\0'))) {
    throw new Error('Database identifier is invalid')
  }
  return parts
    .map((part) =>
      engine === 'sql-server'
        ? `[${part.replaceAll(']', ']]')}]`
        : `"${part.replaceAll('"', '""')}"`
    )
    .join('.')
}

export function buildDatabaseTablePreview(
  engine: DatabaseEngine,
  table: DatabaseTable,
  limit: number
): string {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Database preview limit is invalid')
  }
  const name = quoteDatabaseIdentifier(engine, [table.schema, table.name])
  if (engine === 'sql-server') {
    return `SELECT TOP (${limit}) * FROM ${name}`
  }
  if (engine === 'oracle') {
    return `SELECT * FROM ${name} FETCH FIRST ${limit} ROWS ONLY`
  }
  return `SELECT * FROM ${name} LIMIT ${limit}`
}
