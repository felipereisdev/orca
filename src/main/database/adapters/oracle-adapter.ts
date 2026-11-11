import type oracledb from 'oracledb'
import type { DatabaseAdapter } from './database-adapter'
import { createDatabaseAdapterSessions } from './database-adapter-sessions'
import { withOracleSession } from './oracle-session'
import { assertOraclePrivilegeProfile } from './oracle-privilege-profile'
import { executeOracleResult } from './oracle-result-query'
import { describeOracle } from './oracle-schema'
export function createOracleAdapter(): DatabaseAdapter {
  const sessions = createDatabaseAdapterSessions<oracledb.Connection>(withOracleSession)
  return {
    preflight: (config, credentials, signal) =>
      sessions.run(config, credentials, signal, assertOraclePrivilegeProfile),
    describe: (config, credentials, request, signal) =>
      sessions.run(config, credentials, signal, async (connection) => {
        await assertOraclePrivilegeProfile(connection)
        return describeOracle(connection, request)
      }),
    execute: (config, credentials, query, parameters, sink, signal) =>
      sessions.run(config, credentials, signal, async (connection, activeSignal) => {
        if (query.engine !== 'oracle') {
          throw new Error('Oracle query dialect mismatch')
        }
        await assertOraclePrivilegeProfile(connection)
        await executeOracleResult(connection, query, parameters, sink, activeSignal)
      }),
    dispose: sessions.dispose
  }
}
