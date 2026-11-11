import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseQueryRecord,
  DatabaseQuerySnapshot
} from '../../../shared/database/database-query-contracts'
import type { DatabaseQueryLimits } from '../../../shared/database/database-contracts'
import type { DatabaseResultSink } from '../adapters/database-adapter'
import { encodeDatabaseRow } from './database-result-encoding'

export class DatabaseQueryOutput implements DatabaseResultSink {
  private readonly rows: DatabaseCell[][] = []
  private fields: DatabaseColumn[] = []
  private rowBytes = 0
  private halted = false
  private truncated = false

  constructor(
    private readonly record: DatabaseQueryRecord,
    private readonly limits: DatabaseQueryLimits
  ) {}

  get remainingBytes(): number {
    const envelope = JSON.stringify({
      status: 'completed',
      record: this.record,
      columns: this.fields,
      rows: [],
      rowCount: 0,
      truncated: false,
      limits: this.limits
    })
    return Math.max(
      0,
      this.limits.maxOutputBytes - Buffer.byteLength(envelope) - this.rowBytes - 256
    )
  }

  get stopped(): boolean {
    return this.halted
  }

  columns(columns: DatabaseColumn[]): void {
    if (
      !columns.length ||
      columns.length > 256 ||
      columns.some((column) => column.name.length > 256 || column.databaseType.length > 128)
    ) {
      throw new Error('Database result metadata is unsupported')
    }
    this.fields = columns.map((column, index) => ({ ...column, id: String(index) }))
    if (this.remainingBytes < 2) {
      throw new Error('Database result metadata exceeds its output budget')
    }
  }

  row(values: readonly unknown[]): boolean {
    if (this.halted || this.rows.length >= this.limits.maxRows) {
      this.halted = true
      this.truncated = true
      return false
    }
    const encoded = encodeDatabaseRow(this.fields, values, this.remainingBytes)
    if (!encoded.accepted) {
      this.halted = true
      this.truncated = true
      return false
    }
    this.rows.push(encoded.row)
    this.rowBytes += encoded.bytes + 1
    this.truncated ||= encoded.truncated
    return true
  }

  finish(): Extract<DatabaseQuerySnapshot, { status: 'completed' }> {
    this.record.rowCount = this.rows.length
    this.record.truncated = this.truncated
    const result = {
      status: 'completed' as const,
      record: structuredClone(this.record),
      columns: this.fields,
      rows: this.rows,
      rowCount: this.rows.length,
      truncated: this.truncated,
      limits: this.limits
    }
    if (Buffer.byteLength(JSON.stringify(result)) > this.limits.maxOutputBytes) {
      throw new Error('Database result exceeds its output budget')
    }
    return result
  }
}
