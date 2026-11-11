import type { DatabaseAdapter } from './database-adapter'
import { createDatabaseAdapterSessions } from './database-adapter-sessions'
import { withSqlServerSession, type SqlServerSession } from './sql-server-session'
import { assertSqlServerPrivilegeProfile } from './sql-server-privilege-profile'
import { describeSqlServer } from './sql-server-schema'
import { executeSqlServerResult } from './sql-server-result-query'
export function createSqlServerAdapter(): DatabaseAdapter {
  const sessions = createDatabaseAdapterSessions<SqlServerSession>(withSqlServerSession)
  return {
    preflight: (config, credentials, signal) =>
      sessions.run(config, credentials, signal, assertSqlServerPrivilegeProfile),
    describe: (config, credentials, request, signal) =>
      sessions.run(config, credentials, signal, async (session) => {
        await assertSqlServerPrivilegeProfile(session)
        return describeSqlServer(session, request)
      }),
    execute: (config, credentials, query, parameters, sink, signal) =>
      sessions.run(config, credentials, signal, async (session) => {
        if (query.engine !== 'sql-server') {
          throw new Error('SQL Server query dialect mismatch')
        }
        await assertSqlServerPrivilegeProfile(session)
        await executeSqlServerResult(session, query.statementSql, parameters, sink)
      }),
    dispose: sessions.dispose
  }
}
