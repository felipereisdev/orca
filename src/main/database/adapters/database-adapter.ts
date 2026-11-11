import type {
  DatabaseConnection,
  DatabaseCredentials,
  DatabaseSchemaRequest,
  DatabaseSchemaResult
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
  markTruncated(): void
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

export {
  quoteDatabaseIdentifier,
  buildDatabaseTablePreview
} from '../../../shared/database/database-table-preview'
