import type { DatabaseEngine, DatabaseProjectKey, DatabaseQueryLimits } from './database-contracts'
import type { ExecutionHostId } from '../execution-host'

export type DatabaseParameter = {
  name: string
  type: 'string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'binary'
  value: string | boolean | null
}

export type DatabaseCell =
  | string
  | boolean
  | null
  | { kind: 'preview'; text: string; truncated: true }

export type DatabaseColumn = { id: string; name: string; databaseType: string }

export type DatabaseQueryInput = {
  connection: string
  project: DatabaseProjectKey
  sql: string
  parameters: DatabaseParameter[]
}

export type DatabaseQuerySource = {
  connectionId: string
  connectionRevision: number
  alias: string
  engine: DatabaseEngine
  environment: string
  executionHostId: ExecutionHostId
  controllerRuntimeId: string
}

export type DatabaseQueryHandle = {
  queryId: string
  source: DatabaseQuerySource
}

export type DatabaseQueryStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type DatabaseQueryRecord = DatabaseQueryHandle & {
  project: DatabaseProjectKey
  sessionId: string | null
  sql: string
  parameterNames: string[]
  createdAt: number
  finishedAt: number | null
  status: DatabaseQueryStatus
  rowCount: number
  truncated: boolean
  error?: { code: string; message: string }
}

export type DatabaseQuerySnapshot =
  | { status: 'queued' | 'running'; record: DatabaseQueryRecord }
  | {
      status: 'completed'
      record: DatabaseQueryRecord
      columns: DatabaseColumn[]
      rows: DatabaseCell[][]
      rowCount: number
      truncated: boolean
      limits: DatabaseQueryLimits
    }
  | { status: 'failed' | 'cancelled'; record: DatabaseQueryRecord }

export type ExpiredDatabaseResult = { status: 'expired'; record: DatabaseQueryRecord }
