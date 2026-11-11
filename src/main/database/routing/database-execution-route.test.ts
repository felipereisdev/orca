import { describe, expect, it } from 'vitest'
import { DatabaseExecutionRouter } from './database-execution-route'
import type {
  DatabaseConnection,
  DatabaseProjectKey
} from '../../../shared/database/database-contracts'

const project: DatabaseProjectKey = {
  kind: 'folder',
  projectId: 'same-project',
  executionHostId: 'local'
}
const connection: DatabaseConnection = {
  id: '11111111-1111-4111-8111-111111111111',
  revision: 1,
  alias: 'same-hmg',
  displayName: 'HMG',
  engine: 'postgres',
  environment: 'hmg',
  executionHostId: 'runtime:remote-a',
  projects: [project],
  limits: { timeoutMs: 30000, maxRows: 1000, maxOutputBytes: 5242880 },
  credentialRef: 'fixture',
  endpoint: { server: 'database-on-remote-a', port: 5432, database: 'app', tls: { enabled: true } }
}
const actor = { project, controllerRuntimeId: 'controller-a', sessionId: 'session-a', owner: false }
function router(status: { runtimeId: string; capabilities: string[] } | Error) {
  return new DatabaseExecutionRouter({
    controllerRuntimeId: 'controller-a',
    connection: () => connection,
    resolveServer: (selector) => ({ environmentId: selector, pairingRevision: 7 }),
    callServer: async (_server, method, params, _timeout, binding) => {
      if (status instanceof Error) {
        throw status
      }
      if (method === 'status.get') {
        return status
      }
      return { host: binding?.expectedRuntimeId, project: params, alias: 'same-hmg' }
    }
  })
}

describe('pinned database execution routes', () => {
  it('keeps remote provenance even when another host uses the same project and alias', async () => {
    const remote = router({ runtimeId: 'remote-runtime-a', capabilities: ['database.executionV1'] })
    const route = await remote.resolveDatabaseExecutionRoute(
      { connectionId: connection.id, controllerRuntimeId: 'controller-a' },
      project,
      actor
    )
    expect(route).toMatchObject({
      executionHostId: 'runtime:remote-a',
      controllerRuntimeId: 'controller-a',
      executorRuntimeId: 'remote-runtime-a',
      pairingRevision: 7
    })
    expect(await remote.call(route, 'database.describeBinding', project)).toEqual({
      host: 'remote-runtime-a',
      project,
      alias: 'same-hmg'
    })
    await expect(
      remote.resolveDatabaseExecutionRoute(
        { connectionId: connection.id, controllerRuntimeId: 'controller-b' },
        project,
        actor
      )
    ).rejects.toThrow()
    await expect(
      remote.resolveDatabaseExecutionRoute(
        { connectionId: connection.id, controllerRuntimeId: 'controller-a' },
        { ...project, executionHostId: 'runtime:remote-b' },
        actor
      )
    ).rejects.toThrow()
  })

  it('fails closed for missing capabilities and disconnected execution hosts', async () => {
    for (const status of [
      new Error('Disconnected'),
      { runtimeId: 'old-runtime', capabilities: [] }
    ]) {
      await expect(
        router(status).resolveDatabaseExecutionRoute(
          { connectionId: connection.id, controllerRuntimeId: 'controller-a' },
          project,
          actor
        )
      ).rejects.toMatchObject({
        code: status instanceof Error ? 'database_host_unavailable' : 'database_capability_missing'
      })
    }
    await expect(
      router(new Error('Disconnected')).routeHost(connection.id, connection.executionHostId)
    ).rejects.toMatchObject({ code: 'database_host_unavailable' })
  })
})
