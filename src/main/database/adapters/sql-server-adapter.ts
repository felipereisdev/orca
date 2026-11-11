import { executeSqlServerStatement } from './sql-server-statement'
import type { DatabaseAdapter } from './database-adapter'
import { createDatabaseAdapterSessions } from './database-adapter-sessions'
import { withSqlServerSession, type SqlServerSession } from './sql-server-session'
import { assertSqlServerPrivilegeProfile } from './sql-server-privilege-profile'
import { describeSqlServer } from './sql-server-schema'
import { executeSqlServerResult } from './sql-server-result-query'
export function createSqlServerAdapter(): DatabaseAdapter {
  const sessions = createDatabaseAdapterSessions<SqlServerSession>(withSqlServerSession)
  return {
    executeStatement: (config, credentials, statement, parameters, sink, signal) => {
      if (config.accessMode !== 'read-write') {
        return Promise.reject(new Error('Database write access is disabled'))
      }
      return sessions.run(config, credentials, signal, (session) =>
        executeSqlServerStatement(session, statement, parameters, sink)
      )
    },
    preflight: (config, credentials, signal) =>
      sessions.run(config, credentials, signal, async (session) =>
        config.accessMode === 'read-write'
          ? {
              serverVersion: (
                await session.query<{ version: string }>(
                  "SELECT CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS version"
                )
              ).recordset[0].version,
              readOnlyProfile: false
            }
          : assertSqlServerPrivilegeProfile(session)
      ),
    describe: (config, credentials, request, signal) =>
      sessions.run(config, credentials, signal, async (session) => {
        if (config.accessMode !== 'read-write') {
          await assertSqlServerPrivilegeProfile(session)
        }
        return describeSqlServer(session, request)
      }),
    execute: (config, credentials, query, parameters, sink, signal) =>
      sessions.run(config, credentials, signal, async (session) => {
        if (query.engine !== 'sql-server') {
          throw new Error('SQL Server query dialect mismatch')
        }
        if (config.accessMode !== 'read-write') {
          await assertSqlServerPrivilegeProfile(session)
        }
        await executeSqlServerResult(session, query.statementSql, parameters, sink)
      }),
    dispose: sessions.dispose
  }
}
