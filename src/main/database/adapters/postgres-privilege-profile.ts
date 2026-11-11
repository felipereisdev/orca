import type { Client } from 'pg'
import type { DatabasePreflightResult } from './database-adapter'

const profileSql = `
SELECT current_setting('server_version') AS version,
  NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid)
  AND NOT pg_catalog.has_database_privilege(current_database(), 'CREATE,TEMP')
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE pg_catalog.has_schema_privilege(n.oid, 'CREATE')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
      AND (c.relowner = r.oid OR
        (c.relkind IN ('r','p','v','m','f') AND (
          pg_catalog.has_table_privilege(c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(c.oid, 'INSERT,UPDATE,REFERENCES')
          OR (pg_catalog.has_any_column_privilege(c.oid, 'SELECT') AND (
            c.relrowsecurity OR c.relkind IN ('f','m')
            OR (c.relkind = 'v' AND NOT ('security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))))
            OR EXISTS (
              SELECT 1 FROM pg_catalog.pg_attribute a
              JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
              JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                AND (tn.nspname <> 'pg_catalog' OR t.typtype <> 'b' OR t.typelem <> 0)
            )
          ))
        ))
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND pg_catalog.has_function_privilege(p.oid, 'EXECUTE')
  ) AS safe
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
`

export async function assertPostgresPrivilegeProfile(
  client: Client
): Promise<DatabasePreflightResult> {
  const result = await client.query<{ version: string; safe: boolean }>(profileSql)
  if (result.rows[0]?.safe !== true) {
    throw new Error('PostgreSQL account is outside the supported read-only privilege profile')
  }
  const budget = await client.query<{ total: number; largest: number; bytes: number }>(`
    WITH views AS (
      SELECT pg_catalog.pg_get_viewdef(c.oid, true) AS definition
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'v' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND pg_catalog.has_table_privilege(c.oid, 'SELECT')
    ) SELECT count(*)::integer AS total, max(octet_length(definition)) AS largest,
      sum(octet_length(definition))::integer AS bytes FROM views
  `)
  const limits = budget.rows[0]
  if (limits.total > 1000 || limits.largest > 65536 || limits.bytes > 5 * 1024 * 1024) {
    throw new Error('PostgreSQL view profile exceeds its inspection budget')
  }
  const views = await client.query<{ definition: string }>(`
    SELECT pg_catalog.pg_get_viewdef(c.oid, true) AS definition
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND pg_catalog.has_table_privilege(c.oid, 'SELECT') LIMIT 1001
  `)
  if (views.rows.length > 1000) {
    throw new Error('PostgreSQL view profile exceeds its inspection limit')
  }
  const validate = views.rows.length
    ? (await import('../query-policy/database-query-policy')).validateDatabaseReadQuery
    : undefined
  for (const view of views.rows) {
    validate?.('postgres', view.definition)
  }
  return { serverVersion: result.rows[0].version, readOnlyProfile: true }
}
