import sql from 'mssql'
import type {
  DatabaseColumn,
  DatabaseParameter
} from '../../../shared/database/database-query-contracts'
import type { DatabaseResultSink } from './database-adapter'
import type { SqlServerSession } from './sql-server-session'
import { prepareSqlServerParameters } from './sql-server-parameters'

export async function executeSqlServerResult(
  session: SqlServerSession,
  statement: string,
  parameters: DatabaseParameter[],
  sink: DatabaseResultSink
): Promise<void> {
  const prepared = prepareSqlServerParameters(parameters)
  const metadata = await session.query<{
    name: string | null
    system_type_id: number
    system_type_name: string
    user_type_database: string | null
    error_number: number | null
  }>(
    'SELECT TOP (257) name, system_type_id, system_type_name, user_type_database, error_number FROM sys.dm_exec_describe_first_result_set(@statement,@parameters,0) WHERE is_hidden = 0 OR error_number IS NOT NULL ORDER BY column_ordinal',
    (request) => {
      request.input('statement', sql.NVarChar(sql.MAX), statement)
      request.input('parameters', sql.NVarChar(sql.MAX), prepared.definitions || null)
    }
  )
  const fields = metadata.recordset
  const scalarTypes = new Set([
    36, 40, 41, 42, 43, 48, 52, 56, 104, 106, 108, 127, 165, 167, 173, 175, 231, 239
  ])
  if (
    !fields.length ||
    fields.length > 256 ||
    fields.some(
      (field) =>
        field.error_number || field.user_type_database || !scalarTypes.has(field.system_type_id)
    )
  ) {
    throw new Error('SQL Server result contains unsupported columns or types')
  }
  const columns: DatabaseColumn[] = fields.map((field, index) => ({
    id: String(index),
    name: field.name ?? '',
    databaseType: field.system_type_name
  }))
  const conversions = fields.map(
    (field, index) =>
      `c${index} ${field.system_type_id === 104 ? 'bit' : [165, 173].includes(field.system_type_id) ? 'varbinary(max)' : 'nvarchar(max)'}`
  )
  sink.columns(columns)
  const request = session.request()
  request.stream = true
  request.arrayRowMode = true
  request.input('orca_sql', sql.NVarChar(sql.MAX), statement)
  request.input('orca_def', sql.NVarChar(sql.MAX), prepared.definitions || null)
  prepared.bind(request)
  let bounded = false
  request.on('row', (row: unknown[]) => {
    if (!bounded && !sink.row(row)) {
      bounded = true
      request.cancel()
    }
  })
  try {
    await session.run(
      request,
      `SET TEXTSIZE 8194; ${prepared.declarations}\nEXEC sys.sp_executesql @orca_sql, @orca_def${prepared.arguments ? `, ${prepared.arguments}` : ''} WITH RESULT SETS ((${conversions.join(', ')}))`
    )
  } catch (error) {
    if (!bounded || !(error instanceof sql.RequestError) || error.code !== 'ECANCEL') {
      throw error
    }
  }
}
