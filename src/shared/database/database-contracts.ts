import type { ExecutionHostId } from '../execution-host'

export type DatabaseEngine = 'postgres' | 'sql-server' | 'oracle'

export type DatabaseProjectKey = {
  kind: 'repository' | 'folder'
  projectId: string
  executionHostId: ExecutionHostId
}

export type DatabaseConnectionRef = {
  connectionId: string
  controllerRuntimeId: string
}

export type DatabaseQueryLimits = {
  timeoutMs: number
  maxRows: number
  maxOutputBytes: number
}

export type DatabaseEndpoint = {
  server: string
  port: number
  /** Oracle uses a service name in this field. */
  database: string
  tls: {
    enabled: true
    caCertificate?: string
    serverName?: string
    trustServerCertificate?: boolean
  }
}

export type DatabaseCredentials = {
  username: string
  password: string
}

export type DatabaseConnectionSummary = {
  id: string
  revision: number
  alias: string
  displayName: string
  engine: DatabaseEngine
  environment: string
  executionHostId: ExecutionHostId
  projects: DatabaseProjectKey[]
  limits: DatabaseQueryLimits
}

export type DatabaseConnectionConfiguration = DatabaseConnectionSummary & {
  endpoint: DatabaseEndpoint
  credentialConfigured: boolean
}

export type DatabaseConnection = DatabaseConnectionSummary & {
  endpoint: DatabaseEndpoint
  credentialRef: string
}

export type DatabaseConnectionInput = Omit<
  DatabaseConnectionSummary,
  'id' | 'revision' | 'limits'
> & {
  id?: string
  endpoint: DatabaseEndpoint
  limits?: Partial<DatabaseQueryLimits>
}

export type DatabaseCatalogState = {
  controllerId?: string
  version: 1
  connections: DatabaseConnection[]
  retiredAliases: string[]
}

export type DatabaseSchemaRequest = {
  connection: string
  project: DatabaseProjectKey
  schema?: string
  table?: string
}

export type DatabaseTable = {
  schema: string
  name: string
  kind: 'table' | 'view'
}

export type DatabaseSchemaColumn = {
  name: string
  databaseType: string
  nullable: boolean
  primaryKey: boolean
}

export type DatabaseSchemaResult = {
  schemas: string[]
  tables: DatabaseTable[]
  columns: DatabaseSchemaColumn[]
  truncated: boolean
}
