import type { DatabaseColumn } from '../../../shared/database/database-query-contracts'
import type { DatabaseResultSink } from './database-adapter'

export class DatabaseStatementOutput {
  private first: unknown
  private selected = false
  private columns: DatabaseColumn[] = []
  constructor(private readonly sink: DatabaseResultSink) {}

  result(key: unknown, columns: DatabaseColumn[]): boolean {
    if (!this.selected) {
      this.selected = true
      this.first = key
      this.columns = columns
      this.sink.columns(columns)
    }
    if (key !== this.first) {
      this.sink.markTruncated()
    }
    return key === this.first
  }

  row(key: unknown, values: readonly unknown[]): void {
    if (key !== this.first || this.sink.stopped) {
      return
    }
    this.sink.row(
      values.map((value, index) => {
        if (
          (typeof value === 'number' &&
            (!Number.isFinite(value) ||
              !Number.isSafeInteger(value) ||
              /decimal|numeric|money|number/i.test(this.columns[index]?.databaseType ?? ''))) ||
          value instanceof Date ||
          (value !== null &&
            typeof value === 'object' &&
            !(value instanceof Date) &&
            !(value instanceof Uint8Array))
        ) {
          return {
            kind: 'preview',
            text: '[value unavailable without lossless conversion; cast to text in SQL]',
            truncated: true
          }
        }
        return value
      })
    )
  }
}
