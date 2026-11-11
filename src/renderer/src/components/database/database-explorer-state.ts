import type { DatabaseConnectionRef } from '../../../../shared/database/database-contracts'
import type {
  DatabaseQuerySnapshot,
  ExpiredDatabaseResult
} from '../../../../shared/database/database-query-contracts'

export type DatabaseExplorerResult = DatabaseQuerySnapshot | ExpiredDatabaseResult
export type DatabaseCellSelection = { queryId: string; row: number; columnId: string }
export function createDatabaseExplorerState(connection: DatabaseConnectionRef) {
  let state: {
    connection: DatabaseConnectionRef
    sql: string
    parameters: string
    result: DatabaseExplorerResult | null
    selection: DatabaseCellSelection[]
    loading: boolean
    error: string | null
  } = {
    connection,
    sql: '',
    parameters: '[]',
    result: null,
    selection: [],
    loading: false,
    error: null
  }
  let request = 0
  const listeners = new Set<() => void>()
  const update = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    selectConnection: (connection: DatabaseConnectionRef) => update({ connection }),
    edit: (sql: string) => update({ sql }),
    parameters: (parameters: string) => update({ parameters }),
    error: (error: string | null) => update({ error }),
    async openQuery(
      queryId: string,
      read: (queryId: string) => Promise<DatabaseExplorerResult>,
      restoreEditor = true
    ) {
      const version = ++request
      update({ loading: true, selection: [], error: null, result: null })
      try {
        const result = await read(queryId)
        if (request === version) {
          update({
            result,
            ...(restoreEditor
              ? {
                  sql: result.record.sql,
                  connection: {
                    connectionId: result.record.source.connectionId,
                    controllerRuntimeId: result.record.source.controllerRuntimeId
                  }
                }
              : {})
          })
        }
      } catch (reason) {
        if (request === version) {
          update({ error: reason instanceof Error ? reason.message : String(reason) })
        }
      } finally {
        if (request === version) {
          update({ loading: false })
        }
      }
    },
    selectCell(queryId: string, row: number, columnId: string) {
      const result = state.result
      if (
        result?.status !== 'completed' ||
        result.record.queryId !== queryId ||
        !result.rows[row] ||
        !result.columns.some((column) => column.id === columnId)
      ) {
        return
      }
      const cell = { queryId, row, columnId }
      const selected = state.selection.some(
        (value) => value.queryId === queryId && value.row === row && value.columnId === columnId
      )
      update({
        selection: selected
          ? state.selection.filter((value) => value.row !== row || value.columnId !== columnId)
          : [...state.selection, cell]
      })
    }
  }
}
export type DatabaseExplorerState = ReturnType<typeof createDatabaseExplorerState>
