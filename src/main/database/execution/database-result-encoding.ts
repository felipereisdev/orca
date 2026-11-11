import type {
  DatabaseCell,
  DatabaseColumn
} from '../../../shared/database/database-query-contracts'
import { clampUtf8TextPrefix } from '../../../shared/utf8-byte-limits'

export type EncodedDatabaseRow = {
  row: DatabaseCell[]
  bytes: number
  accepted: boolean
  truncated: boolean
}

function encodeCell(column: DatabaseColumn, value: unknown, maxTextBytes: number): DatabaseCell {
  if (value === null || typeof value === 'boolean') {
    return value
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'preview' &&
    'text' in value &&
    typeof value.text === 'string' &&
    'truncated' in value &&
    value.truncated === true
  ) {
    return { kind: 'preview', text: clampUtf8TextPrefix(value.text, maxTextBytes), truncated: true }
  }
  if (value instanceof Uint8Array) {
    const length = Math.min(value.byteLength, Math.floor(maxTextBytes / 4) * 3)
    const text = Buffer.from(value.buffer, value.byteOffset, length).toString('base64')
    return { kind: 'preview', text, truncated: true }
  }
  let text: string
  if (typeof value === 'string') {
    text = value
  } else if (typeof value === 'bigint') {
    text = value.toString()
  } else if (value instanceof Date) {
    text = value.toISOString()
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error('Database driver returned a number without lossless precision')
    }
    if (/numeric|decimal|number/i.test(column.databaseType) && !Number.isInteger(value)) {
      throw new Error('Exact database decimals must be returned as strings by the adapter')
    }
    text = String(value)
  } else {
    throw new Error('Database driver returned an unsupported value type')
  }
  const prefix = clampUtf8TextPrefix(text, maxTextBytes)
  return prefix === text ? text : { kind: 'preview', text: prefix, truncated: true }
}

export function encodeDatabaseRow(
  columns: readonly DatabaseColumn[],
  values: readonly unknown[],
  remainingBytes: number
): EncodedDatabaseRow {
  if (columns.length !== values.length || columns.length > 256) {
    throw new Error('Database result columns are unsupported')
  }
  if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 2) {
    return { row: [], bytes: 0, accepted: false, truncated: true }
  }
  // JSON can escape one text byte into six; reserve preview metadata before clipping values.
  const maxTextBytes = Math.min(
    4096,
    Math.max(
      0,
      Math.floor((remainingBytes - 2 - columns.length * 60) / (Math.max(columns.length, 1) * 6))
    )
  )
  const row = values.map((value, index) => encodeCell(columns[index], value, maxTextBytes))
  const bytes = Buffer.byteLength(JSON.stringify(row))
  if (bytes > remainingBytes) {
    return { row: [], bytes: 0, accepted: false, truncated: true }
  }
  return {
    row,
    bytes,
    accepted: true,
    truncated: row.some((cell) => typeof cell === 'object' && cell !== null)
  }
}
