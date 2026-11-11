import type {
  DatabaseConnectionConfiguration,
  DatabaseEngine,
  DatabaseProjectKey
} from '../../../../../shared/database/database-contracts'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { databaseConnectionInputSchema } from '../../../../../shared/database/database-configuration-schema'

export type DatabaseConnectionDraft = {
  accessMode: 'read-only' | 'read-write'
  alias: string
  displayName: string
  engine: DatabaseEngine
  environment: string
  executionHostId: ExecutionHostId
  projects: DatabaseProjectKey[]
  server: string
  port: string
  database: string
  caCertificate: string
  serverName: string
  trustServerCertificate: boolean
  username: string
  password: string
}
export function databaseConnectionDraft(
  connection?: DatabaseConnectionConfiguration
): DatabaseConnectionDraft {
  return {
    accessMode: connection?.accessMode ?? 'read-only',
    alias: connection?.alias ?? '',
    displayName: connection?.displayName ?? '',
    engine: connection?.engine ?? 'postgres',
    environment: connection?.environment ?? '',
    executionHostId: connection?.executionHostId ?? 'local',
    projects: connection?.projects ?? [],
    server: connection?.endpoint.server ?? '',
    port: String(connection?.endpoint.port ?? 5432),
    database: connection?.endpoint.database ?? '',
    caCertificate: connection?.endpoint.tls.caCertificate ?? '',
    serverName: connection?.endpoint.tls.serverName ?? '',
    trustServerCertificate: connection?.endpoint.tls.trustServerCertificate === true,
    username: '',
    password: ''
  }
}
export function databaseConnectionInput(
  draft: DatabaseConnectionDraft,
  original?: DatabaseConnectionConfiguration
) {
  return databaseConnectionInputSchema.parse({
    accessMode: draft.accessMode,
    id: original?.id,
    alias: draft.alias,
    displayName: draft.displayName,
    engine: draft.engine,
    environment: draft.environment,
    executionHostId: draft.executionHostId,
    projects: draft.projects,
    endpoint: {
      server: draft.server,
      port: Number(draft.port),
      database: draft.database,
      tls: {
        enabled: true,
        trustServerCertificate:
          draft.engine === 'sql-server' ? draft.trustServerCertificate : undefined,
        caCertificate: draft.caCertificate || undefined,
        serverName: draft.serverName || undefined
      }
    },
    limits: original?.limits
  })
}
export const databaseEngineNames: Record<DatabaseEngine, string> = {
  postgres: 'PostgreSQL',
  'sql-server': 'SQL Server',
  oracle: 'Oracle'
}
