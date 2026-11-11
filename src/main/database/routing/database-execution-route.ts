import {
  DatabaseOperationError,
  isDatabaseOperationErrorCode
} from '../../../shared/database/database-operation-error'
import { z } from 'zod'
import type {
  DatabaseConnection,
  DatabaseConnectionRef,
  DatabaseProjectKey
} from '../../../shared/database/database-contracts'
import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import type { DatabaseActor } from '../execution/database-query-actor'
import { sameDatabaseProject } from '../catalog/database-project-scope'

export type DatabaseExecutionRoute = {
  controllerRuntimeId: string
  connectionId: string
  executionHostId: ExecutionHostId
  executorRuntimeId: string
  environmentId?: string
  pairingRevision?: number
}
export type DatabaseRouteBinding = {
  expectedRuntimeId?: string
  expectedEnvironmentPairingRevision?: number
}
export type DatabaseRoutePorts = {
  controllerRuntimeId: string
  connection(id: string, project: DatabaseProjectKey): DatabaseConnection
  resolveServer(selector: string): { environmentId: string; pairingRevision?: number }
  callServer(
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs?: number,
    binding?: DatabaseRouteBinding
  ): Promise<unknown>
}
const statusSchema = z.object({
  runtimeId: z.string().min(1),
  capabilities: z.array(z.string()).optional()
})

export class DatabaseExecutionRouter {
  constructor(private readonly ports: DatabaseRoutePorts) {}

  async resolveDatabaseExecutionRoute(
    ref: DatabaseConnectionRef,
    project: DatabaseProjectKey,
    actor: DatabaseActor
  ): Promise<DatabaseExecutionRoute> {
    if (
      ref.controllerRuntimeId !== this.ports.controllerRuntimeId ||
      actor.controllerRuntimeId !== ref.controllerRuntimeId ||
      !sameDatabaseProject(project, actor.project)
    ) {
      throw new Error('Database controller or project binding does not match')
    }
    const connection = this.ports.connection(ref.connectionId, project)
    if (
      connection.id !== ref.connectionId ||
      !connection.projects.some((item) => sameDatabaseProject(item, project))
    ) {
      throw new Error('Database connection is outside its registered project')
    }
    return this.routeHost(connection.id, connection.executionHostId, connection.accessMode)
  }

  async routeHost(
    connectionId: string,
    executionHostId: ExecutionHostId,
    accessMode?: 'read-only' | 'read-write'
  ): Promise<DatabaseExecutionRoute> {
    const base = {
      controllerRuntimeId: this.ports.controllerRuntimeId,
      connectionId,
      executionHostId
    }
    if (executionHostId === 'local') {
      return { ...base, executorRuntimeId: this.ports.controllerRuntimeId }
    }
    const host = parseExecutionHostId(executionHostId)
    if (host?.kind !== 'runtime') {
      throw new DatabaseOperationError('database_capability_missing')
    }
    try {
      const server = this.ports.resolveServer(host.environmentId)
      const raw = await this.ports.callServer(
        server.environmentId,
        'status.get',
        undefined,
        10000,
        { expectedEnvironmentPairingRevision: server.pairingRevision }
      )
      const status = statusSchema.parse(raw)
      if (
        !status.capabilities?.includes('database.executionV1') ||
        (accessMode === 'read-write' && !status.capabilities.includes('database.writeV1'))
      ) {
        throw new DatabaseOperationError('database_capability_missing')
      }
      return {
        ...base,
        executorRuntimeId: status.runtimeId,
        environmentId: server.environmentId,
        pairingRevision: server.pairingRevision
      }
    } catch (error) {
      if (error instanceof DatabaseOperationError) {
        throw error
      }
      throw new DatabaseOperationError('database_host_unavailable')
    }
  }

  async call(
    route: DatabaseExecutionRoute,
    method: string,
    params: unknown,
    timeoutMs = 30000
  ): Promise<unknown> {
    if (route.controllerRuntimeId !== this.ports.controllerRuntimeId || !route.environmentId) {
      throw new Error('Database execution route is not a registered remote binding')
    }
    try {
      return await this.ports.callServer(route.environmentId, method, params, timeoutMs, {
        expectedRuntimeId: route.executorRuntimeId,
        expectedEnvironmentPairingRevision: route.pairingRevision
      })
    } catch (error) {
      if (error instanceof Error && 'code' in error && isDatabaseOperationErrorCode(error.code)) {
        throw new DatabaseOperationError(error.code)
      }
      throw new DatabaseOperationError('database_host_unavailable')
    }
  }
}
