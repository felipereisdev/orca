import oracledb from 'oracledb'
import { tokenizeOracleStatement } from '@orca/sql-read-query-parser/read-query'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
import type { DatabaseResultSink } from './database-adapter'
import { isOracleLob } from './oracle-result-query'
import { prepareOracleParameters } from './oracle-parameters'
import { DatabaseStatementOutput } from './database-statement-output'

export async function executeOracleStatement(
  connection: oracledb.Connection,
  statement: string,
  parameters: DatabaseParameter[],
  sink: DatabaseResultSink,
  signal: AbortSignal
) {
  const prepared = parameters.length
    ? await prepareOracleParameters(tokenizeOracleStatement(statement), parameters, true)
    : { statement, binds: {} }
  const result = await connection.execute<unknown[]>(prepared.statement, prepared.binds, {
    autoCommit: true,
    resultSet: true,
    outFormat: oracledb.OUT_FORMAT_ARRAY,
    prefetchRows: 0,
    fetchArraySize: 1,
    keepInStmtCache: false,
    fetchTypeHandler: (metadata) =>
      metadata.dbType === oracledb.DB_TYPE_NUMBER ? { type: oracledb.STRING } : undefined
  })
  if (result.rowsAffected !== undefined) {
    sink.affectedRows?.(result.rowsAffected)
  }
  const implicit =
    result.implicitResults?.filter(
      (value): value is oracledb.ResultSet<unknown[]> => !Array.isArray(value)
    ) ?? []
  const rows = result.resultSet ?? implicit[0]
  const fields = result.metaData ?? rows?.metaData
  try {
    if (implicit.length > (result.resultSet ? 0 : 1)) {
      sink.markTruncated()
    }
    if (!rows || !fields?.length) {
      return
    }
    const output = new DatabaseStatementOutput(sink)
    output.result(
      rows,
      fields.map((field, index) => ({
        id: String(index),
        name: field.name,
        databaseType: field.dbTypeName ?? 'unknown'
      }))
    )
    while (!sink.stopped) {
      signal.throwIfAborted()
      const row = await rows.getRow()
      if (!row) {
        break
      }
      const bounded: unknown[] = []
      for (const value of row) {
        if (isOracleLob(value)) {
          try {
            bounded.push(await value.getData(1, value.type === oracledb.DB_TYPE_BLOB ? 3073 : 4097))
          } finally {
            await value.close()
          }
        } else {
          bounded.push(value)
        }
      }
      output.row(rows, bounded)
    }
    if (sink.stopped) {
      sink.markTruncated()
    }
  } finally {
    await Promise.all(
      [...new Set([rows, ...implicit])].map((value) => value?.close().catch(() => {}))
    )
  }
}
