import { DatabaseOperationError } from '../../../shared/database/database-operation-error'
import type { DatabasePreflightResult } from './database-adapter'
import type { SqlServerSession } from './sql-server-session'

export async function assertSqlServerPrivilegeProfile(
  session: SqlServerSession
): Promise<DatabasePreflightResult> {
  const result = await session
    .query<{ version: string; safe: boolean }>(`
SELECT CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS version, CONVERT(bit, CASE WHEN
  DB_ID() > 4 AND USER_NAME() <> 'dbo'
  AND NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE type = 'R' AND name <> 'public' AND IS_SRVROLEMEMBER(name) = 1)
  AND NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE type = 'R' AND name NOT IN ('public','db_datareader') AND IS_ROLEMEMBER(name) = 1)
  AND NOT EXISTS (SELECT 1 FROM sys.fn_my_permissions(NULL,'SERVER') WHERE permission_name NOT IN ('CONNECT SQL','VIEW ANY DATABASE'))
  AND NOT EXISTS (SELECT 1 FROM sys.fn_my_permissions(NULL,'DATABASE') WHERE permission_name NOT IN ('CONNECT','SELECT','VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION','VIEW ANY COLUMN ENCRYPTION KEY DEFINITION','VIEW ANY COLUMN MASTER KEY DEFINITION'))
  AND HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION') = 1
  AND (SELECT COUNT(*) FROM sys.objects WHERE is_ms_shipped = 0) <= 10000
  AND NOT EXISTS (SELECT 1 FROM sys.schemas s CROSS APPLY sys.fn_my_permissions(QUOTENAME(s.name),'SCHEMA') p WHERE p.permission_name NOT IN ('SELECT','VIEW DEFINITION') AND s.name NOT IN ('sys','INFORMATION_SCHEMA'))
  AND NOT EXISTS (SELECT 1 FROM sys.objects o CROSS APPLY sys.fn_my_permissions(QUOTENAME(OBJECT_SCHEMA_NAME(o.object_id))+'.'+QUOTENAME(o.name),'OBJECT') p WHERE o.is_ms_shipped = 0 AND p.permission_name NOT IN ('SELECT','VIEW DEFINITION'))
  AND NOT EXISTS (SELECT 1 FROM sys.objects o WHERE o.is_ms_shipped = 0 AND o.parent_object_id = 0 AND (HAS_PERMS_BY_NAME(QUOTENAME(OBJECT_SCHEMA_NAME(o.object_id))+'.'+QUOTENAME(o.name),'OBJECT','SELECT') = 1 OR EXISTS (SELECT 1 FROM sys.columns visible WHERE visible.object_id = o.object_id AND HAS_PERMS_BY_NAME(QUOTENAME(OBJECT_SCHEMA_NAME(o.object_id))+'.'+QUOTENAME(o.name),'OBJECT','SELECT',visible.name,'COLUMN') = 1)) AND (
    o.type <> 'U' OR EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = o.object_id AND (c.is_computed = 1 OR c.user_type_id <> c.system_type_id))
    OR EXISTS (SELECT 1 FROM sys.security_predicates p WHERE p.target_object_id = o.object_id)
    OR EXISTS (SELECT 1 FROM sys.external_tables e WHERE e.object_id = o.object_id)))
  THEN 1 ELSE 0 END) AS safe`)
    .catch(() => {
      throw new DatabaseOperationError('database_read_only_verification_failed')
    })
  if (result.recordset[0]?.safe !== true) {
    throw new DatabaseOperationError('database_read_only_profile_refused')
  }
  return { serverVersion: result.recordset[0].version, readOnlyProfile: true }
}
