import oracledb from 'oracledb'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
import type { DatabaseResultSink } from './database-adapter'
import { prepareOracleParameters } from './oracle-parameters'
function isOracleLob(value: unknown): value is oracledb.Lob {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getData' in value &&
    typeof value.getData === 'function' &&
    'close' in value &&
    typeof value.close === 'function'
  )
}
export async function executeOracleResult(
  connection: oracledb.Connection,
  statement: string,
  parameters: DatabaseParameter[],
  sink: DatabaseResultSink,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const prepared = await prepareOracleParameters(statement, parameters)
  const stringTypes = new Set<oracledb.DbType>([
    oracledb.DB_TYPE_NUMBER,
    oracledb.DB_TYPE_DATE,
    oracledb.DB_TYPE_TIMESTAMP,
    oracledb.DB_TYPE_TIMESTAMP_TZ,
    oracledb.DB_TYPE_TIMESTAMP_LTZ
  ])
  const nativeTypes = new Set<oracledb.DbType>([
    oracledb.DB_TYPE_VARCHAR,
    oracledb.DB_TYPE_NVARCHAR,
    oracledb.DB_TYPE_CHAR,
    oracledb.DB_TYPE_NCHAR,
    oracledb.DB_TYPE_RAW,
    oracledb.DB_TYPE_CLOB,
    oracledb.DB_TYPE_NCLOB,
    oracledb.DB_TYPE_BLOB,
    oracledb.DB_TYPE_BOOLEAN
  ])
  const result = await connection.execute<unknown[]>(prepared.statement, prepared.binds, {
    resultSet: true,
    outFormat: oracledb.OUT_FORMAT_ARRAY,
    prefetchRows: 0,
    fetchArraySize: 1,
    keepInStmtCache: false,
    fetchTypeHandler: (metadata) => {
      if (!metadata.dbType) {
        throw new Error('Oracle column has no type metadata')
      }
      if (stringTypes.has(metadata.dbType)) {
        return { type: oracledb.STRING }
      }
      if (!nativeTypes.has(metadata.dbType)) {
        throw new Error('Oracle result contains an unsupported type')
      }
      return undefined
    }
  })
  const rows = result.resultSet
  try {
    const fields = result.metaData
    if (!rows || !fields?.length || fields.length > 256) {
      throw new Error('Oracle result columns exceed the supported limit')
    }
    sink.columns(
      fields.map((field, index) => ({
        id: String(index),
        name: field.dbColumnName ?? field.name,
        databaseType: field.dbTypeName ?? field.dbType?.name ?? 'unknown'
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
      if (!sink.row(bounded)) {
        break
      }
    }
  } finally {
    await rows?.close().catch(() => {})
  }
}
