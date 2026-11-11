import type { z } from 'zod'
import type {
  DatabaseBindingQuery,
  DatabaseBindingStart,
  DatabaseBindingDescribe
} from '../../../shared/rpc-contract/database-params'
import type { DatabaseExecutionBindings } from '../../database/routing/database-execution-bindings'
import type { DatabaseCredentialStore } from '../../database/credentials/database-credential-store'
import type { DatabaseAdapter } from '../../database/adapters/database-adapter'
import type { DatabaseEngine } from '../../../shared/database/database-contracts'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'
import { sameDatabaseProject } from '../../database/catalog/database-project-scope'
import { DatabaseQueryService } from '../../database/execution/database-query-service'
import type { DatabaseQueryAdmission } from '../../database/execution/database-query-admission'
import type { DatabaseQueryRecords } from '../../database/execution/database-query-records'

type QueryScope = z.infer<typeof DatabaseBindingQuery>
type BoundQueryPorts = {
  bindings: DatabaseExecutionBindings
  credentials: DatabaseCredentialStore
  store: Pick<DatabasePersistence, 'getDatabaseQueryHistory' | 'saveDatabaseQueryRecord'>
  adapter(engine: DatabaseEngine): DatabaseAdapter | undefined
  admission: DatabaseQueryAdmission
  records: DatabaseQueryRecords
}
export class DatabaseBoundQueryCommands {
  private readonly services = new Map<string, DatabaseQueryService>()
  constructor(private readonly ports: BoundQueryPorts) {}

  private connection(principalId: string, ref: string) {
    return this.ports.bindings.read(principalId, ref).connection
  }
  private actor(principalId: string, input: QueryScope) {
    const connection = this.connection(principalId, input.credentialRef)
    if (!connection.projects.some((project) => sameDatabaseProject(project, input.project))) {
      throw new Error('Database execution binding is outside the requested project')
    }
    return {
      controllerRuntimeId: input.controllerRuntimeId,
      project: input.project,
      sessionId: `${principalId}:${input.sessionId}`,
      owner: false
    }
  }
  private service(principalId: string, input: QueryScope) {
    const key = JSON.stringify([principalId, input.controllerRuntimeId, input.credentialRef])
    let service = this.services.get(key)
    if (!service) {
      const connection = this.connection(principalId, input.credentialRef)
      service = new DatabaseQueryService({
        ...this.ports,
        controllerRuntimeId: input.controllerRuntimeId,
        executionHostId: connection.executionHostId,
        catalog: {
          resolve: (selector, project) => {
            const current = this.connection(principalId, input.credentialRef)
            if (
              selector !== current.id ||
              !current.projects.some((item) => sameDatabaseProject(item, project))
            ) {
              throw new Error('Database execution binding changed')
            }
            return current
          }
        }
      })
      this.services.set(key, service)
    }
    return service
  }
  start(principalId: string, input: z.infer<typeof DatabaseBindingStart>) {
    const actor = this.actor(principalId, input)
    const connection = this.connection(principalId, input.credentialRef)
    return this.service(principalId, input).start(
      {
        connection: connection.id,
        project: input.project,
        sql: input.sql,
        parameters: input.parameters
      },
      actor,
      input.queryId
    )
  }
  async wait(principalId: string, input: QueryScope, signal: AbortSignal) {
    const actor = this.actor(principalId, input)
    const service = this.service(principalId, input)
    const deadline = AbortSignal.timeout(25000)
    try {
      return await service.wait(input.queryId, actor, AbortSignal.any([signal, deadline]))
    } catch (error) {
      if (deadline.aborted && !signal.aborted) {
        return service.result(input.queryId, actor)
      }
      throw error
    }
  }
  cancel(principalId: string, input: QueryScope) {
    const actor = this.actor(principalId, input)
    return this.service(principalId, input).cancel(input.queryId, actor)
  }
  async test(principalId: string, ref: string, signal: AbortSignal) {
    const connection = this.connection(principalId, ref)
    const adapter = this.ports.adapter(connection.engine)
    if (!adapter) {
      throw new Error('database_capability_missing')
    }
    try {
      return await adapter.preflight(connection, await this.ports.credentials.read(ref), signal)
    } catch {
      throw new Error('Database read-only verification failed')
    }
  }
  async describe(
    principalId: string,
    input: z.infer<typeof DatabaseBindingDescribe>,
    signal: AbortSignal
  ) {
    const connection = this.connection(principalId, input.credentialRef)
    if (!connection.projects.some((project) => sameDatabaseProject(project, input.project))) {
      throw new Error('Database schema binding is outside the requested project')
    }
    const adapter = this.ports.adapter(connection.engine)
    if (!adapter) {
      throw new Error('database_capability_missing')
    }
    try {
      return await adapter.describe(
        connection,
        await this.ports.credentials.read(input.credentialRef),
        {
          ...input,
          connection: connection.id
        },
        signal
      )
    } catch {
      throw new Error('Database schema could not be inspected')
    }
  }
  async dispose() {
    await Promise.all([...this.services.values()].map((service) => service.dispose()))
    this.services.clear()
  }
}
