import type {
  DatabaseMentionReference,
  ResolvedDatabaseMention
} from '../../../../shared/database/database-mention-reference'
import type {
  DatabaseSettingsOptions,
  DatabaseHostCapabilities
} from '../../../../shared/database/database-settings-options'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { z } from 'zod'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { RuntimeStatus } from '../../../../shared/runtime-session-contracts'
import type {
  DatabaseConnectionConfiguration,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseCredentials,
  DatabaseSchemaResult
} from '../../../../shared/database/database-contracts'
import type {
  DatabaseParameter,
  DatabaseQueryHandle,
  DatabaseQueryRecord
} from '../../../../shared/database/database-query-contracts'
import {
  databaseQueryResultSchema,
  databaseQueryRecordSchema
} from '../../../../shared/database/database-query-result-schema'
import { DATABASE_RUNTIME_CAPABILITIES } from '../../../../shared/database/database-runtime-capabilities'
import type { DatabaseScope } from '../../../../shared/rpc-contract/database-params'
import { callRuntimeRpc } from '../rpc/calls/runtime-rpc-call'
import { captureRuntimeEnvironmentRequestRevision } from '../rpc/environment-revisions/runtime-environment-revision'

type Scope = z.infer<typeof DatabaseScope>

export function createDatabaseRuntimeClient(target: RuntimeClientTarget) {
  const pairingRevision =
    target.kind === 'environment'
      ? captureRuntimeEnvironmentRequestRevision(target.environmentId)
      : undefined
  let ready: Promise<RuntimeStatus> | undefined
  const status = () => {
    ready ??= callRuntimeRpc<RuntimeStatus>(target, 'status.get', undefined, {
      expectedEnvironmentPairingRevision: pairingRevision
    })
      .then((value) => {
        if (
          !DATABASE_RUNTIME_CAPABILITIES.every((capability) =>
            value.capabilities?.includes(capability)
          )
        ) {
          throw new Error('This Orca runtime does not support read-only database connections')
        }
        return value
      })
      .catch((error) => {
        ready = undefined
        throw error
      })
    return ready
  }
  const call = async <T>(method: string, params?: unknown, signal?: AbortSignal): Promise<T> => {
    const current = await status()
    return callRuntimeRpc<T>(target, method, params, {
      signal,
      timeoutMs: 30000,
      expectedEnvironmentPairingRevision: pairingRevision,
      expectedEnvironmentRuntimeId: current.runtimeId
    })
  }
  return {
    target,
    status,
    controllerIdentity: () =>
      call<{ controllerRuntimeId: string }>('database.executionCapabilities').then(
        (value) => value.controllerRuntimeId
      ),
    settingsOptions: () => call<DatabaseSettingsOptions>('database.settingsOptions'),
    hostCapabilities: (executionHostId: ExecutionHostId) =>
      call<DatabaseHostCapabilities>('database.hostCapabilities', { executionHostId }),
    catalog: () => call<DatabaseConnectionSummary[]>('database.catalog'),
    configuration: (connectionId: string) =>
      call<DatabaseConnectionConfiguration>('database.configuration', { connectionId }),
    save: (
      configuration: DatabaseConnectionInput,
      credentials?: DatabaseCredentials,
      expectedRevision?: number
    ) =>
      call<DatabaseConnectionConfiguration>('database.save', {
        configuration,
        credentials,
        expectedRevision
      }),
    remove: (connectionId: string, expectedRevision: number) =>
      call<void>('database.remove', { connectionId, expectedRevision }),
    clearHistory: (connectionId: string) => call<void>('database.clearHistory', { connectionId }),
    test: (connectionId: string, signal?: AbortSignal) =>
      call<{ serverVersion: string; readOnlyProfile: boolean }>(
        'database.testConnection',
        { connectionId },
        signal
      ),
    list: (scope: Scope) => call<DatabaseConnectionSummary[]>('database.list', scope),
    resolveMentions: (scope: Scope, references: readonly DatabaseMentionReference[]) =>
      call<ResolvedDatabaseMention[]>('database.resolveMentions', { ...scope, references }),
    describe: (
      scope: Scope,
      connection: string,
      schema?: string,
      table?: string,
      signal?: AbortSignal
    ) =>
      call<DatabaseSchemaResult>(
        'database.describe',
        { ...scope, connection, schema, table },
        signal
      ),
    start: (scope: Scope, connection: string, sql: string, parameters: DatabaseParameter[] = []) =>
      call<DatabaseQueryHandle>('database.startQuery', { ...scope, connection, sql, parameters }),
    wait: async (scope: Scope, queryId: string, signal?: AbortSignal) =>
      databaseQueryResultSchema.parse(
        await call('database.waitQuery', { ...scope, queryId }, signal)
      ),
    result: async (scope: Scope, queryId: string) =>
      databaseQueryResultSchema.parse(await call('database.queryResult', { ...scope, queryId })),
    sessionQueryRecord: async (scope: Scope, queryId: string, sessionId: string) =>
      databaseQueryRecordSchema.parse(
        await call('database.sessionQueryRecord', { ...scope, queryId, sessionId })
      ),
    sessionQuery: async (scope: Scope, queryId: string, sessionId: string) =>
      databaseQueryResultSchema.parse(
        await call('database.sessionQuery', { ...scope, queryId, sessionId })
      ),
    cancel: (scope: Scope, queryId: string) =>
      call<void>('database.cancelQuery', { ...scope, queryId }),
    history: (scope: Scope) => call<DatabaseQueryRecord[]>('database.queryHistory', scope)
  }
}
export type DatabaseRuntimeClient = ReturnType<typeof createDatabaseRuntimeClient>
