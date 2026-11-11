import { DatabaseOperationError } from '../../../shared/database/database-operation-error'
import { getSecretStore } from '../../../shared/secret-store'
import { z } from 'zod'
import { databaseSettingsOptions } from './database-settings-options'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { DatabaseQueryAdmission } from '../../database/execution/database-query-admission'
import { DatabaseQueryRecords } from '../../database/execution/database-query-records'
import { DatabaseExecutionRouter } from '../../database/routing/database-execution-route'
import { DatabaseExecutionBindings } from '../../database/routing/database-execution-bindings'
import { executeRemoteDatabaseQuery } from '../../database/routing/database-remote-execution'
import { DatabaseBoundQueryCommands } from './database-bound-query-commands'
import { DatabaseConnectionWriter } from './database-connection-writer'
import type {
  DatabaseConnectionInput,
  DatabaseCredentials,
  DatabaseEngine,
  DatabaseSchemaRequest
} from '../../../shared/database/database-contracts'
import { DatabaseCatalog } from '../../database/catalog/database-catalog'
import { DatabaseCredentialStore } from '../../database/credentials/database-credential-store'
import { DatabaseQueryService } from '../../database/execution/database-query-service'
import { createOracleAdapter } from '../../database/adapters/oracle-adapter'
import { createSqlServerAdapter } from '../../database/adapters/sql-server-adapter'
import { createPostgresAdapter } from '../../database/adapters/postgres-adapter'
import type { DatabaseAdapter } from '../../database/adapters/database-adapter'
import type { DatabaseRuntimeHost } from './database-project-context'
import { requireDatabasePersistence } from './runtime-database-persistence'

export class RuntimeDatabaseCommands {
  readonly catalog: DatabaseCatalog
  readonly credentials: DatabaseCredentialStore
  readonly queries: DatabaseQueryService
  readonly bindings: DatabaseExecutionBindings
  readonly boundQueries: DatabaseBoundQueryCommands
  private readonly router: DatabaseExecutionRouter
  private readonly writer: DatabaseConnectionWriter
  private readonly persistence: ReturnType<typeof requireDatabasePersistence>
  private readonly adapters = new Map<DatabaseEngine, DatabaseAdapter>([
    ['postgres', createPostgresAdapter()],
    ['sql-server', createSqlServerAdapter()],
    ['oracle', createOracleAdapter()]
  ])

  constructor(
    private readonly runtime: DatabaseRuntimeHost,
    readonly controllerRuntimeId: string
  ) {
    const store = requireDatabasePersistence(runtime.requireStore())
    this.persistence = store
    this.catalog = new DatabaseCatalog(store)
    this.credentials = new DatabaseCredentialStore(store)
    this.router = new DatabaseExecutionRouter({
      controllerRuntimeId: this.controllerRuntimeId,
      connection: (id, project) => this.catalog.resolve(id, project),
      resolveServer: (selector) => {
        if (!runtime.resolveOrchestrationWorkerServer) {
          throw new Error('database_host_unavailable')
        }
        return runtime.resolveOrchestrationWorkerServer(selector)
      },
      callServer: async (selector, method, params, timeoutMs, binding) => {
        if (!runtime.callOrchestrationWorkerServer) {
          throw new Error('database_host_unavailable')
        }
        return runtime.callOrchestrationWorkerServer(
          selector,
          method,
          params,
          timeoutMs,
          undefined,
          binding
        )
      }
    })
    this.writer = new DatabaseConnectionWriter(
      runtime,
      store,
      this.catalog,
      this.credentials,
      this.router,
      this.controllerRuntimeId
    )
    this.bindings = new DatabaseExecutionBindings(store, this.credentials)
    const admission = new DatabaseQueryAdmission()
    const records = new DatabaseQueryRecords(store)
    this.boundQueries = new DatabaseBoundQueryCommands({
      bindings: this.bindings,
      credentials: this.credentials,
      store,
      adapter: (engine) => this.adapters.get(engine),
      admission,
      records
    })
    this.queries = new DatabaseQueryService({
      admission,
      records,
      remoteExecution: (...args) => executeRemoteDatabaseQuery(this.router, ...args),
      store,
      catalog: this.catalog,
      credentials: this.credentials,
      controllerRuntimeId: this.controllerRuntimeId,
      executionHostId: 'local',
      adapter: (engine) => this.adapters.get(engine)
    })
  }

  executionCapabilities() {
    const keyring = getSecretStore()
    return {
      controllerRuntimeId: this.controllerRuntimeId,
      engines: [...this.adapters.keys()],
      protectedCredentialStorage:
        keyring.isEncryptionAvailable() && keyring.describeProtectionGap() === null
    }
  }
  settingsOptions() {
    return databaseSettingsOptions(this.runtime, this.executionCapabilities())
  }
  async hostCapabilities(executionHostId: ExecutionHostId) {
    if (executionHostId === 'local') {
      return this.executionCapabilities()
    }
    const route = await this.router.routeHost('capability-probe', executionHostId)
    return z
      .object({
        engines: z.array(z.enum(['postgres', 'sql-server', 'oracle'])).max(3),
        protectedCredentialStorage: z.boolean()
      })
      .parse(await this.router.call(route, 'database.executionCapabilities', undefined))
  }

  save(
    input: DatabaseConnectionInput,
    credentials?: DatabaseCredentials,
    expectedRevision?: number
  ) {
    return this.writer.save(input, credentials, expectedRevision)
  }

  async clearHistory(id: string): Promise<void> {
    this.catalog.getConfiguration(id)
    await this.queries.clearConnectionHistory(id)
  }
  remove(id: string, revision: number) {
    return this.writer.remove(id, revision, () => this.queries.clearConnectionHistory(id))
  }

  async test(id: string, signal: AbortSignal) {
    const connection = this.persistence
      .getDatabaseCatalog()
      .connections.find((item) => item.id === id)
    if (!connection) {
      throw new Error('database_host_unavailable')
    }
    if (connection.executionHostId !== 'local') {
      const route = await this.router.routeHost(connection.id, connection.executionHostId)
      return this.router.call(route, 'database.testBinding', {
        credentialRef: connection.credentialRef,
        controllerRuntimeId: this.controllerRuntimeId
      })
    }
    const adapter = this.adapters.get(connection.engine)
    if (!adapter) {
      throw new Error('database_capability_missing')
    }
    try {
      return await adapter.preflight(
        connection,
        await this.credentials.read(connection.credentialRef),
        signal
      )
    } catch (error) {
      if (error instanceof DatabaseOperationError) {
        throw error
      }
      throw new Error('Database connection or read-only privilege verification failed')
    }
  }

  async describe(request: DatabaseSchemaRequest, signal: AbortSignal) {
    const connection = this.catalog.resolve(request.connection, request.project)
    if (connection.executionHostId !== 'local') {
      const route = await this.router.routeHost(connection.id, connection.executionHostId)
      return this.router.call(route, 'database.describeBinding', {
        ...request,
        credentialRef: connection.credentialRef,
        controllerRuntimeId: this.controllerRuntimeId
      })
    }
    const adapter = this.adapters.get(connection.engine)
    if (!adapter) {
      throw new Error('database_capability_missing')
    }
    try {
      return await adapter.describe(
        connection,
        await this.credentials.read(connection.credentialRef),
        request,
        signal
      )
    } catch (error) {
      if (error instanceof DatabaseOperationError) {
        throw error
      }
      throw new Error('Database schema could not be inspected')
    }
  }

  async dispose() {
    await this.queries.dispose()
    await this.boundQueries.dispose()
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.dispose()))
  }
}
