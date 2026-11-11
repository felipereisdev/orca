import sql from 'mssql'
import type {
  DatabaseSchemaRequest,
  DatabaseSchemaResult,
  DatabaseTable,
  DatabaseSchemaColumn
} from '../../../shared/database/database-contracts'
import type { SqlServerSession } from './sql-server-session'
export async function describeSqlServer(
  session: SqlServerSession,
  request: DatabaseSchemaRequest
): Promise<DatabaseSchemaResult> {
  const schemas = (
    await session.query<{ name: string }>(
      `SELECT TOP (1001) s.name FROM sys.schemas s WHERE s.name NOT IN ('sys','INFORMATION_SCHEMA') AND EXISTS (SELECT 1 FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id WHERE t.schema_id = s.schema_id AND HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'.'+QUOTENAME(t.name),'OBJECT','SELECT',c.name,'COLUMN') = 1) ORDER BY s.name`
    )
  ).recordset
  const tables = request.schema
    ? (
        await session.query<DatabaseTable>(
          `SELECT TOP (1001) s.name AS [schema], t.name, 'table' AS kind FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = @schema AND EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id AND HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'.'+QUOTENAME(t.name),'OBJECT','SELECT',c.name,'COLUMN') = 1) ORDER BY t.name`,
          (query) => query.input('schema', sql.NVarChar(128), request.schema)
        )
      ).recordset
    : []
  const columns =
    request.schema && request.table
      ? (
          await session.query<DatabaseSchemaColumn>(
            `SELECT TOP (1001) c.name, ty.name AS databaseType, CONVERT(bit,c.is_nullable) AS nullable, CONVERT(bit,CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id WHERE i.object_id = t.object_id AND i.is_primary_key = 1 AND ic.column_id = c.column_id) THEN 1 ELSE 0 END) AS primaryKey FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id WHERE s.name = @schema AND t.name = @table AND HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'.'+QUOTENAME(t.name),'OBJECT','SELECT',c.name,'COLUMN') = 1 ORDER BY c.column_id`,
            (query) => {
              query.input('schema', sql.NVarChar(128), request.schema)
              query.input('table', sql.NVarChar(128), request.table)
            }
          )
        ).recordset
      : []
  return {
    schemas: schemas.slice(0, 1000).map((schema) => schema.name),
    tables: tables.slice(0, 1000),
    columns: columns.slice(0, 1000),
    truncated: [schemas, tables, columns].some((rows) => rows.length > 1000)
  }
}
