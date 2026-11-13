import type {
  DatabaseQueryRecord,
  DatabaseQuerySnapshot,
  ExpiredDatabaseResult
} from '../../../src/shared/database/database-query-contracts'

export type QueryResult = DatabaseQuerySnapshot | ExpiredDatabaseResult
export type QueryState = {
  snapshot: QueryResult | null
  queryId: string | null
  error: string | null
  starting: boolean
  cancelling: boolean
  loadingResult: boolean
  running: boolean
  history: DatabaseQueryRecord[]
  historyLoading: boolean
  historyError: string | null
}

export const emptyState: QueryState = {
  snapshot: null,
  queryId: null,
  error: null,
  starting: false,
  cancelling: false,
  loadingResult: false,
  running: false,
  history: [],
  historyLoading: false,
  historyError: null
}

export type MobileDatabaseQueryScope = {
  active: boolean
  startLocked: boolean
  queryId: string | null
  selection: number
  historyRequest: number
  readAbort: AbortController
}
