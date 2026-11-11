import { randomUUID } from 'node:crypto'
import oracledb from 'oracledb'
import type { DatabaseColumn } from '../../../shared/database/database-query-contracts'

export async function prepareOracleResultProjection(
  connection: oracledb.Connection,
  query: { statement: string; withPrefix: string; body: string }
): Promise<{ statement: string; columns: DatabaseColumn[]; temporalColumns: ReadonlySet<number> }> {
  const info = await connection.getStatementInfo(query.statement)
  const fields = info.metaData
  if (!fields?.length || fields.length > 256) {
    throw new Error('Oracle result columns exceed the supported limit')
  }
  const temporalColumns = new Set<number>()
  const projections = fields.map((field, index) => {
    const column = `c${index}`
    if (field.dbType === oracledb.DB_TYPE_DATE) {
      temporalColumns.add(index)
      return `TO_CHAR(${column},'YYYY-MM-DD"T"HH24:MI:SS')`
    }
    if (field.dbType === oracledb.DB_TYPE_TIMESTAMP) {
      temporalColumns.add(index)
      return `TO_CHAR(${column},'YYYY-MM-DD"T"HH24:MI:SS.FF9')`
    }
    if (
      field.dbType === oracledb.DB_TYPE_TIMESTAMP_TZ ||
      field.dbType === oracledb.DB_TYPE_TIMESTAMP_LTZ
    ) {
      temporalColumns.add(index)
      const value =
        field.dbType === oracledb.DB_TYPE_TIMESTAMP_LTZ ? `${column} AT TIME ZONE '+00:00'` : column
      return `TO_CHAR(${value},'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM')`
    }
    return column
  })
  const name = `orca_output_${randomUUID().replaceAll('-', '')}`
  const aliases = fields.map((_field, index) => `c${index}`).join(', ')
  return {
    statement: temporalColumns.size
      ? `WITH ${query.withPrefix ? `${query.withPrefix}, ` : ''}${name}(${aliases}) AS (${query.body}) SELECT ${projections.join(', ')} FROM ${name}`
      : query.statement,
    temporalColumns,
    columns: fields.map((field, index) => ({
      id: String(index),
      name: field.dbColumnName ?? field.name,
      databaseType: field.dbTypeName ?? field.dbType?.name ?? 'unknown'
    }))
  }
}
