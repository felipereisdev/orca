import { Query, types, type Client, type QueryResult, type QueryArrayConfig } from 'pg'
import type { DatabaseQueryLimits } from '../../../shared/database/database-contracts'
import type {
  DatabaseCell,
  DatabaseParameter
} from '../../../shared/database/database-query-contracts'
import type { DatabaseResultSink } from './database-adapter'
import { encodeDatabaseRow } from '../execution/database-result-encoding'
import { bindPostgresParameters } from './postgres-parameters'

const columnsFor = (result: QueryResult) =>
  result.fields.map((field, index) => ({
    id: String(index),
    name: field.name,
    databaseType: String(field.dataTypeID)
  }))

export async function executePostgresStatement(
  client: Client,
  statement: string,
  parameters: DatabaseParameter[],
  sink: DatabaseResultSink,
  limits: DatabaseQueryLimits
) {
  const config: QueryArrayConfig = {
    text: statement,
    values: bindPostgresParameters(parameters),
    rowMode: 'array',
    types: {
      getTypeParser: (oid) =>
        oid === 16 || oid === 17 ? types.getTypeParser(oid) : (value: string) => value
    }
  }
  const query = new Query<unknown[]>(config)
  await new Promise<void>((resolve, reject) => {
    let failure: unknown
    let candidate: QueryResult | undefined
    const preview: DatabaseCell[][] = []
    let bytes = 0
    let truncated = false
    query.on('row', (row, result) => {
      try {
        if (!result) {
          throw new Error('PostgreSQL result metadata is unavailable')
        }
        candidate ??= result
        if (result !== candidate) {
          return
        }
        if (preview.length >= limits.maxRows) {
          truncated = true
          return
        }
        const columns = columnsFor(result)
        const remaining = Math.max(
          0,
          sink.remainingBytes - bytes - Buffer.byteLength(JSON.stringify(columns)) - 256
        )
        const encoded = encodeDatabaseRow(columns, row, remaining)
        if (!encoded.accepted) {
          truncated = true
          return
        }
        preview.push(encoded.row)
        bytes += encoded.bytes + 1
        truncated ||= encoded.truncated
      } catch (error) {
        failure ??= error
      }
    })
    query.once('error', reject)
    query.once('end', (result: QueryResult | QueryResult[]) => {
      try {
        if (failure) {
          reject(failure)
          return
        }
        const results = Array.isArray(result) ? result : [result]
        const sets = results.filter((item) => item.fields.length > 0)
        if (sets[0]) {
          sink.columns(columnsFor(sets[0]))
          if (sets[0] === candidate) {
            for (const row of preview) {
              if (!sink.row(row)) {
                break
              }
            }
          }
        }
        for (const item of results) {
          if (item.rowCount !== null) {
            sink.affectedRows?.(item.rowCount)
          }
        }
        if (truncated || sets.length > 1) {
          sink.markTruncated()
        }
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    client.query(query)
  })
}
