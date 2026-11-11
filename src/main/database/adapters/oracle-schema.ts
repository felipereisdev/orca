import type oracledb from 'oracledb'
import type {
  DatabaseSchemaRequest,
  DatabaseSchemaResult
} from '../../../shared/database/database-contracts'
export async function describeOracle(
  connection: oracledb.Connection,
  request: DatabaseSchemaRequest
): Promise<DatabaseSchemaResult> {
  const schemas =
    (
      await connection.execute<[string]>(
        `SELECT DISTINCT t.owner FROM all_tables t JOIN all_users u ON u.username=t.owner WHERE u.oracle_maintained='N' ORDER BY t.owner FETCH FIRST 1001 ROWS ONLY`
      )
    ).rows ?? []
  const tables = request.schema
    ? ((
        await connection.execute<[string, string]>(
          `SELECT owner,table_name FROM all_tables WHERE owner=:owner ORDER BY table_name FETCH FIRST 1001 ROWS ONLY`,
          { owner: request.schema }
        )
      ).rows ?? [])
    : []
  const columns =
    request.schema && request.table
      ? ((
          await connection.execute<[string, string, string, number]>(
            `SELECT c.column_name,c.data_type,c.nullable,CASE WHEN EXISTS (SELECT 1 FROM all_constraints k JOIN all_cons_columns kc ON kc.owner=k.owner AND kc.constraint_name=k.constraint_name WHERE k.owner=c.owner AND k.table_name=c.table_name AND k.constraint_type='P' AND kc.column_name=c.column_name) THEN 1 ELSE 0 END FROM all_tab_columns c WHERE c.owner=:owner AND c.table_name=:table_name ORDER BY column_id FETCH FIRST 1001 ROWS ONLY`,
            { owner: request.schema, table_name: request.table }
          )
        ).rows ?? [])
      : []
  return {
    schemas: schemas.slice(0, 1000).map((row) => row[0]),
    tables: tables.slice(0, 1000).map((row) => ({ schema: row[0], name: row[1], kind: 'table' })),
    columns: columns.slice(0, 1000).map((row) => ({
      name: row[0],
      databaseType: row[1],
      nullable: row[2] === 'Y',
      primaryKey: row[3] === 1
    })),
    truncated: [schemas, tables, columns].some((rows) => rows.length > 1000)
  }
}
