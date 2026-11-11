import type oracledb from 'oracledb'
import type { DatabasePreflightResult } from './database-adapter'
export async function assertOraclePrivilegeProfile(
  connection: oracledb.Connection
): Promise<DatabasePreflightResult> {
  const profile = await connection.execute<[number]>(`
SELECT CASE WHEN USER NOT IN ('SYS','SYSTEM','DBSNMP','OUTLN')
 AND NOT EXISTS (SELECT 1 FROM session_roles)
 AND NOT EXISTS (SELECT 1 FROM session_privs WHERE privilege <> 'CREATE SESSION')
 AND NOT EXISTS (SELECT 1 FROM user_objects)
 AND NOT EXISTS (SELECT 1 FROM all_tab_privs WHERE grantee=USER AND (privilege NOT IN ('SELECT','READ') OR grantable='YES'))
 AND NOT EXISTS (SELECT 1 FROM all_col_privs WHERE grantee IN (USER,'PUBLIC') AND privilege NOT IN ('SELECT','READ'))
 AND NOT EXISTS (SELECT 1 FROM all_tab_privs p JOIN all_users u ON u.username=p.table_schema WHERE p.grantee IN (USER,'PUBLIC') AND u.oracle_maintained='N' AND NOT (p.grantee='PUBLIC' AND p.privilege='INHERIT PRIVILEGES') AND (p.privilege NOT IN ('SELECT','READ') OR p.grantable='YES'))
 AND NOT EXISTS (SELECT 1 FROM all_tab_privs p JOIN all_users u ON u.username=p.table_schema JOIN all_objects o ON o.owner=p.table_schema AND o.object_name=p.table_name AND o.subobject_name IS NULL WHERE p.grantee IN (USER,'PUBLIC') AND p.privilege IN ('SELECT','READ') AND u.oracle_maintained='N' AND (o.object_type <> 'TABLE'
   OR EXISTS (SELECT 1 FROM all_external_tables e WHERE e.owner=o.owner AND e.table_name=o.object_name)
   OR EXISTS (SELECT 1 FROM all_tab_cols c WHERE c.owner=o.owner AND c.table_name=o.object_name AND (c.virtual_column='YES' OR c.data_type_owner IS NOT NULL))
   OR EXISTS (SELECT 1 FROM all_policies r WHERE r.object_owner=o.owner AND r.object_name=o.object_name)))
 AND NOT EXISTS (SELECT 1 FROM all_synonyms s JOIN all_users u ON u.username=s.table_owner WHERE s.owner IN (USER,'PUBLIC') AND u.oracle_maintained='N')
 THEN 1 ELSE 0 END FROM dual`)
  if (profile.rows?.[0][0] !== 1) {
    throw new Error('Oracle account is outside the supported read-only privilege profile')
  }
  return { serverVersion: connection.oracleServerVersionString ?? 'unknown', readOnlyProfile: true }
}
