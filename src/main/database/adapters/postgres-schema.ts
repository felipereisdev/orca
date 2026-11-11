import type { Client } from 'pg'
import type {
  DatabaseSchemaRequest,
  DatabaseSchemaResult,
  DatabaseTable,
  DatabaseSchemaColumn
} from '../../../shared/database/database-contracts'

export async function describePostgres(
  client: Client,
  request: DatabaseSchemaRequest
): Promise<DatabaseSchemaResult> {
  const schemas = await client.query<{ name: string }>(`
    SELECT nspname AS name FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg_%'
      AND pg_catalog.has_schema_privilege(oid, 'USAGE') ORDER BY nspname LIMIT 1001
  `)
  const tables = request.schema
    ? await client.query<DatabaseTable>(
        `
    SELECT n.nspname AS schema, c.relname AS name,
      CASE WHEN c.relkind = 'v' THEN 'view' ELSE 'table' END AS kind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v')
      AND pg_catalog.has_any_column_privilege(c.oid, 'SELECT')
    ORDER BY c.relname LIMIT 1001
  `,
        [request.schema]
      )
    : { rows: [] }
  const columns =
    request.schema && request.table
      ? await client.query<DatabaseSchemaColumn>(
          `
    SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, NULL) AS "databaseType",
      NOT a.attnotnull AS nullable,
      EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid
        AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS "primaryKey"
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
    ORDER BY a.attnum LIMIT 1001
  `,
          [request.schema, request.table]
        )
      : { rows: [] }
  return {
    schemas: schemas.rows.slice(0, 1000).map((row) => row.name),
    tables: tables.rows.slice(0, 1000),
    columns: columns.rows.slice(0, 1000),
    truncated: [schemas, tables, columns].some((result) => result.rows.length > 1000)
  }
}
