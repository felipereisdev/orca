import { executeOracleStatement } from './oracle-statement'
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
    executeStatement: (config, credentials, statement, parameters, sink, signal) => {
      if (config.accessMode !== 'read-write') {
        return Promise.reject(new Error('Database write access is disabled'))
      }
      return sessions.run(config, credentials, signal, (connection, activeSignal) =>
        executeOracleStatement(connection, statement, parameters, sink, activeSignal)
      )
    },
    preflight: (config, credentials, signal) =>
      sessions.run(config, credentials, signal, async (connection) =>
        config.accessMode === 'read-write'
          ? {
              serverVersion: connection.oracleServerVersionString ?? 'Oracle',
              readOnlyProfile: false
            }
          : assertOraclePrivilegeProfile(connection)
      ),
    describe: (config, credentials, request, signal) =>
      sessions.run(config, credentials, signal, async (connection) => {
        if (config.accessMode !== 'read-write') {
          await assertOraclePrivilegeProfile(connection)
        }
        return describeOracle(connection, request)
      }),
    execute: (config, credentials, query, parameters, sink, signal) =>
      sessions.run(config, credentials, signal, async (connection, activeSignal) => {
        if (query.engine !== 'oracle') {
          throw new Error('Oracle query dialect mismatch')
        }
        if (config.accessMode !== 'read-write') {
          await assertOraclePrivilegeProfile(connection)
        }
        await executeOracleResult(connection, query, parameters, sink, activeSignal)
      }),
    dispose: sessions.dispose
  }
}
