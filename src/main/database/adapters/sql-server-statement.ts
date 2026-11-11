import type sql from 'mssql'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
import type { DatabaseResultSink } from './database-adapter'
import type { SqlServerSession } from './sql-server-session'
import { prepareSqlServerParameters } from './sql-server-parameters'
import { DatabaseStatementOutput } from './database-statement-output'

export async function executeSqlServerStatement(
  session: SqlServerSession,
  statement: string,
  parameters: DatabaseParameter[],
  sink: DatabaseResultSink
) {
  const prepared = prepareSqlServerParameters(parameters)
  const request = session.request()
  request.stream = true
  request.arrayRowMode = true
  prepared.bind(request)
  const output = new DatabaseStatementOutput(sink)
  let current: unknown
  let failure: unknown
  request.on('recordset', (fields: sql.IColumnMetadata[string][]) => {
    try {
      current = fields
      output.result(
        current,
        fields.map((field, index) => ({
          id: String(index),
          name: field.name,
          databaseType: typeof field.type === 'function' ? field.type.name : 'unknown'
        }))
      )
    } catch (error) {
      failure ??= error
    }
  })
  request.on('row', (row: unknown[]) => {
    try {
      output.row(current, row)
    } catch (error) {
      failure ??= error
    }
  })
  request.on('rowsaffected', (count: number) => {
    try {
      sink.affectedRows?.(count)
    } catch (error) {
      failure ??= error
    }
  })
  const declarations = parameters.length
    ? `SET NOCOUNT ON; ${prepared.namedDeclarations}\nSET NOCOUNT OFF;`
    : ''
  await session.run(request, `${declarations}\n${statement}`)
  if (failure) {
    throw failure
  }
}
