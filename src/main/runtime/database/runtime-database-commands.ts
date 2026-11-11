import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  DatabaseConnectionInput,
  DatabaseCredentials,
  DatabaseEngine,
  DatabaseSchemaRequest
} from '../../../shared/database/database-contracts'
import { DatabaseCatalog } from '../../database/catalog/database-catalog'
import { DatabaseCredentialStore } from '../../database/credentials/database-credential-store'
import { DatabaseQueryService } from '../../database/execution/database-query-service'
import { createPostgresAdapter } from '../../database/adapters/postgres-adapter'
import type { DatabaseAdapter } from '../../database/adapters/database-adapter'
import {
  resolveDatabaseProject,
  type DatabaseScope,
  type DatabaseRuntimeHost
} from './database-project-context'
import { requireDatabasePersistence } from './runtime-database-persistence'

export class RuntimeDatabaseCommands {
  readonly catalog: DatabaseCatalog
  readonly credentials: DatabaseCredentialStore
  readonly queries: DatabaseQueryService
  private readonly persistence: ReturnType<typeof requireDatabasePersistence>
  private readonly adapters = new Map<DatabaseEngine, DatabaseAdapter>([
    ['postgres', createPostgresAdapter()]
  ])

  constructor(private readonly runtime: DatabaseRuntimeHost) {
    const store = requireDatabasePersistence(runtime.requireStore())
    this.persistence = store
    this.catalog = new DatabaseCatalog(store)
    this.credentials = new DatabaseCredentialStore(store)
    this.queries = new DatabaseQueryService({
      store,
      catalog: this.catalog,
      credentials: this.credentials,
      controllerRuntimeId: runtime.getRuntimeId(),
      executionHostId: 'local',
      adapter: (engine) => this.adapters.get(engine)
    })
  }

  async list(scope: DatabaseScope) {
    return this.catalog.list(await resolveDatabaseProject(this.runtime, scope))
  }

  async save(
    input: DatabaseConnectionInput,
    credentials: DatabaseCredentials | undefined,
    expectedRevision?: number
  ) {
    const previous = input.id
      ? this.persistence.getDatabaseCatalog().connections.find((item) => item.id === input.id)
      : undefined
    if (input.executionHostId !== 'local') {
      throw new Error('database_host_unavailable')
    }
    for (const project of input.projects) {
      const resolved = await resolveDatabaseProject(this.runtime, { project: project.projectId })
      if (resolved.kind !== project.kind || resolved.executionHostId !== project.executionHostId) {
        throw new Error('Database project association is unavailable on this host')
      }
    }
    const id = input.id ?? randomUUID()
    const staged = credentials ? await this.credentials.enroll(id, credentials) : undefined
    const credentialRef = staged ?? previous?.credentialRef
    if (!credentialRef) {
      throw new Error('Database connection requires protected credentials')
    }
    let saved
    try {
      saved = await this.catalog.save({ ...input, id, credentialRef }, expectedRevision)
    } catch (error) {
      if (staged) {
        await this.credentials.remove(staged).catch(() => {})
      }
      throw error
    }
    if (staged && previous) {
      await this.credentials.remove(previous.credentialRef).catch(() => {})
    }
    return saved
  }

  async remove(id: string, revision: number): Promise<void> {
    const previous = this.persistence
      .getDatabaseCatalog()
      .connections.find((item) => item.id === id)
    await this.catalog.remove(id, revision)
    if (previous) {
      await this.credentials.remove(previous.credentialRef)
    }
  }

  async test(id: string, signal: AbortSignal) {
    const connection = this.persistence
      .getDatabaseCatalog()
      .connections.find((item) => item.id === id)
    if (!connection || connection.executionHostId !== 'local') {
      throw new Error('database_host_unavailable')
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
    } catch {
      throw new Error('Database connection or read-only privilege verification failed')
    }
  }

  async describe(request: DatabaseSchemaRequest, signal: AbortSignal) {
    const connection = this.catalog.resolve(request.connection, request.project)
    if (connection.executionHostId !== 'local') {
      throw new Error('database_host_unavailable')
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
    } catch {
      throw new Error('Database schema could not be inspected')
    }
  }

  async dispose() {
    await this.queries.dispose()
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.dispose()))
  }
}

const controllers = new WeakMap<OrcaRuntimeService, RuntimeDatabaseCommands>()
export function runtimeDatabaseCommands(runtime: OrcaRuntimeService): RuntimeDatabaseCommands {
  let commands = controllers.get(runtime)
  if (!commands) {
    commands = new RuntimeDatabaseCommands(runtime)
    controllers.set(runtime, commands)
  }
  return commands
}
export async function disposeRuntimeDatabase(runtime: OrcaRuntimeService): Promise<void> {
  await controllers.get(runtime)?.dispose()
}
