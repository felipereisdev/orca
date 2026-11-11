import type { DatabaseResultSink } from '../../src/main/database/adapters/database-adapter'
import type { DatabaseColumn } from '../../src/shared/database/database-query-contracts'
export function captureDatabaseResult(limit = 1000) {
  const rows: unknown[][] = []
  const columns: DatabaseColumn[] = []
  const names: string[] = []
  const sink: DatabaseResultSink = {
    markTruncated: () => {},
    columns: (value) => {
      columns.push(...value)
      names.push(...value.map((column) => column.name))
    },
    row: (values) => {
      if (rows.length >= limit) {
        return false
      }
      rows.push([...values])
      return true
    },
    remainingBytes: 5242880,
    stopped: false
  }
  return { rows, columns, names, sink }
}
