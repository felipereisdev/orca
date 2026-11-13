import * as z from 'zod'
import type {
  DatabaseConnectionSummary,
  DatabaseSchemaResult
} from '../../../src/shared/database/database-contracts'
import type {
  DatabaseParameter,
  DatabaseQueryHandle,
  DatabaseQueryRecord,
  DatabaseQuerySnapshot,
  ExpiredDatabaseResult
} from '../../../src/shared/database/database-query-contracts'
import {
  databaseQueryRecordSchema,
  databaseQueryResultSchema
} from '../../../src/shared/database/database-query-result-schema'
import type { RpcMethodName } from '../../../src/shared/rpc-contract/rpc-params-catalog.generated'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import {
  bindDeferredRpcOperation,
  defineRpcOperation,
  runRpcOperation
} from '../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../transport/rpc/rpc-operation-result-reader'
import { connectionHostStatusRead } from '../query/host-status-query'
import { hostStatusSchema } from '../transport/hosts/host-status-reply-schema'
import {
  mobileDatabaseConnectionsSchema,
  mobileDatabaseQueryHandleSchema,
  mobileDatabaseSchemaResultSchema
} from './mobile-database-reply-schema'

function databaseOperation<Method extends RpcMethodName, Schema extends z.ZodType>(
  method: Method,
  schema: Schema
) {
  return defineRpcOperation({
    name: method,
    method,
    acceptance: 'require-result-or-throw',
    barrier: 'on-settle',
    read: rpcResultVariant(method, schema)
  })
}

const list = databaseOperation('database.list', mobileDatabaseConnectionsSchema)
const describe = databaseOperation('database.describe', mobileDatabaseSchemaResultSchema)
const start = databaseOperation('database.startQuery', mobileDatabaseQueryHandleSchema)
const wait = databaseOperation('database.waitQuery', databaseQueryResultSchema)
const result = databaseOperation('database.queryResult', databaseQueryResultSchema)
const cancel = databaseOperation('database.cancelQuery', z.void())
const history = databaseOperation('database.queryHistory', z.array(databaseQueryRecordSchema))
const controllerIdentity = databaseOperation(
  'database.executionCapabilities',
  z.object({ controllerRuntimeId: z.string().min(1).max(1024) })
)
const status = connectionHostStatusRead(
  bindDeferredRpcOperation(
    defineRpcOperation({
      name: 'status.database',
      method: 'status.get',
      acceptance: 'require-result-or-throw',
      barrier: 'after-caller-barrier',
      read: rpcResultVariant('database-host-status', hostStatusSchema)
    })
  )
)

type QueryResult = DatabaseQuerySnapshot | ExpiredDatabaseResult

export function createMobileDatabaseClient(client: RpcClient, worktreeId: string) {
  const scope = { worktree: `id:${worktreeId}` }
  const requestOptions = { timeoutMs: 30_000, failWhenDisconnected: true }
  return {
    status: async () => status.interpret(await status.request(client, undefined, requestOptions)),
    controllerIdentity: async (): Promise<string> =>
      (await runRpcOperation(client, controllerIdentity, undefined, requestOptions))
        .controllerRuntimeId,
    list: (): Promise<DatabaseConnectionSummary[]> =>
      runRpcOperation(client, list, scope, requestOptions),
    describe: (
      connection: string,
      schema?: string,
      table?: string,
      signal?: AbortSignal
    ): Promise<DatabaseSchemaResult> =>
      runRpcOperation(
        client,
        describe,
        { ...scope, connection, schema, table },
        { ...requestOptions, signal }
      ),
    start: (
      connection: string,
      sql: string,
      parameters: DatabaseParameter[] = []
    ): Promise<DatabaseQueryHandle> =>
      runRpcOperation(client, start, { ...scope, connection, sql, parameters }, requestOptions),
    wait: (queryId: string, signal?: AbortSignal): Promise<QueryResult> =>
      runRpcOperation(client, wait, { ...scope, queryId }, { ...requestOptions, signal }),
    result: (queryId: string, signal?: AbortSignal): Promise<QueryResult> =>
      runRpcOperation(client, result, { ...scope, queryId }, { ...requestOptions, signal }),
    cancel: (queryId: string): Promise<void> =>
      runRpcOperation(client, cancel, { ...scope, queryId }, requestOptions),
    history: (): Promise<DatabaseQueryRecord[]> =>
      runRpcOperation(client, history, scope, requestOptions)
  }
}

export type MobileDatabaseClient = ReturnType<typeof createMobileDatabaseClient>
