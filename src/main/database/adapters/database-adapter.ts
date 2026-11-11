import type {
  DatabaseConnection,
  DatabaseCredentials,
  DatabaseEngine,
  DatabaseSchemaRequest,
  DatabaseSchemaResult,
  DatabaseTable
} from '../../../shared/database/database-contracts'
import type {
  DatabaseColumn,
  DatabaseParameter
} from '../../../shared/database/database-query-contracts'
import type { ValidatedDatabaseReadQuery } from '../query-policy/database-query-policy'

export type DatabasePreflightResult = {
  serverVersion: string
  readOnlyProfile: boolean
}

export type DatabaseResultSink = {
  columns(columns: DatabaseColumn[]): void
  row(values: readonly unknown[]): boolean
  readonly remainingBytes: number
  readonly stopped: boolean
}

export type DatabaseAdapter = {
  preflight(
    config: DatabaseConnection,
    credentials: DatabaseCredentials,
    signal: AbortSignal
  ): Promise<DatabasePreflightResult>
  describe(
    config: DatabaseConnection,
    credentials: DatabaseCredentials,
    request: DatabaseSchemaRequest,
    signal: AbortSignal
  ): Promise<DatabaseSchemaResult>
  execute(
    config: DatabaseConnection,
    credentials: DatabaseCredentials,
    query: ValidatedDatabaseReadQuery,
    parameters: DatabaseParameter[],
    sink: DatabaseResultSink,
    signal: AbortSignal
  ): Promise<void>
  dispose(): Promise<void>
}

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
