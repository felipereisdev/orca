import { installFakeAppEnvironment } from '../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPostgresFixture } from './postgres-fixture'
import { createDatabaseTestProfile } from '../../src/main/database/catalog/testing/database-profile-fixture'
import { OrcaRuntimeService } from '../../src/main/runtime/orca-runtime'
import { RpcDispatcher } from '../../src/main/runtime/rpc/dispatcher'
import { DATABASE_METHODS } from '../../src/main/runtime/rpc/methods/database/database'
import { DATABASE_BINDING_METHODS } from '../../src/main/runtime/rpc/methods/database/database-bindings'
import { disposeRuntimeDatabase } from '../../src/main/runtime/database/runtime-database-service-slot'
import type { RuntimeRpcResponse } from '../../src/shared/runtime-rpc-envelope'
import type { DatabaseConnectionConfiguration } from '../../src/shared/database/database-contracts'
import type {
  DatabaseQueryHandle,
  DatabaseQuerySnapshot
} from '../../src/shared/database/database-query-contracts'
import { waitForPromiseWithSignal } from '../../src/shared/abort-signal-reason'

let fixture: Awaited<ReturnType<typeof createPostgresFixture>>
let controllerProfile: ReturnType<typeof createDatabaseTestProfile>
let executorProfile: ReturnType<typeof createDatabaseTestProfile>
let controller: OrcaRuntimeService
let executor: OrcaRuntimeService
let dispatcher: RpcDispatcher
let executorDispatcher: RpcDispatcher
let configuration: DatabaseConnectionConfiguration
let projectId: string
const network = new AbortController()

async function call<T>(method: string, params: unknown): Promise<T> {
  const response = await dispatcher.dispatch({
    id: randomUUID(),
    authToken: 'fixture',
    method,
    params
  })
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`)
  }
  return response.result as T
}

beforeAll(async () => {
  installFakeAppEnvironment()
  fixture = await createPostgresFixture()
  controllerProfile = createDatabaseTestProfile()
  executorProfile = createDatabaseTestProfile()
  executor = new OrcaRuntimeService(executorProfile.store)
  executorDispatcher = new RpcDispatcher({ runtime: executor, methods: DATABASE_BINDING_METHODS })
  controller = new OrcaRuntimeService(controllerProfile.store, undefined, {
    orchestrationEnvironmentTransport: {
      resolve: (selector) => {
        if (selector !== 'remote-a') {
          throw new Error('Unknown execution host')
        }
        return {
          environmentId: 'remote-a',
          name: 'SSH-managed runtime fixture',
          peerFingerprint: 'executor-fingerprint',
          pairingRevision: 7
        }
      },
      call: async (
        _selector,
        method,
        params,
        timeoutMs,
        _envelope,
        revision,
        send
      ): Promise<RuntimeRpcResponse<unknown>> => {
        network.signal.throwIfAborted()
        if (revision !== undefined && revision !== 7) {
          throw new Error('Pairing changed')
        }
        if (send?.expectedRuntimeId && send.expectedRuntimeId !== executor.getRuntimeId()) {
          throw new Error('Runtime changed')
        }
        if (method === 'status.get') {
          return {
            id: randomUUID(),
            ok: true,
            _meta: { runtimeId: executor.getRuntimeId() },
            result: {
              runtimeId: executor.getRuntimeId(),
              capabilities: ['database.catalogV1', 'database.executionV1']
            }
          }
        }
        return waitForPromiseWithSignal(
          executorDispatcher.dispatch(
            { id: randomUUID(), authToken: 'fixture', method, params },
            {
              caller: { kind: 'paired-device', deviceId: 'controller-device' },
              pairedDeviceId: 'controller-device',
              authenticatedCallerFingerprint: 'controller-principal',
              callerScope: { kind: 'runtime-paired', grants: [] },
              clientKind: 'runtime',
              signal: AbortSignal.any([network.signal, AbortSignal.timeout(timeoutMs ?? 30000)])
            }
          ),
          network.signal
        )
      }
    }
  })
  dispatcher = new RpcDispatcher({ runtime: controller, methods: DATABASE_METHODS })
  const group = controllerProfile.store.createProjectGroup({
    name: 'Folder outside Git',
    createdFrom: 'manual'
  })
  const folder = controllerProfile.store.createFolderWorkspace({
    projectGroupId: group.id,
    folderPath: '/fixture/notes'
  })
  projectId = folder.id
  configuration = await call('database.save', {
    configuration: {
      ...fixture.configuration,
      id: undefined,
      alias: 'same-hmg',
      executionHostId: 'runtime:remote-a',
      projects: [{ kind: 'folder', projectId, executionHostId: 'local' }]
    },
    credentials: fixture.credentials
  })
})
beforeEach(() => {
  executorProfile.installKeyring()
})
afterAll(async () => {
  if (controller) {
    await disposeRuntimeDatabase(controller)
  }
  if (executor) {
    await disposeRuntimeDatabase(executor)
  }
  await executorProfile?.close()
  await controllerProfile?.close()
  await fixture?.close()
})

describe('database controller and authenticated execution runtime', () => {
  it('keeps credentials only on the executor and returns the pinned remote result to the controller', async () => {
    const binding = executorProfile.store.getDatabaseExecutionBindings()[0]
    expect(executorProfile.store.getDatabaseCatalog().connections).toEqual([])
    expect(
      controllerProfile.store.getDatabaseCredential(binding.connection.credentialRef)
    ).toBeUndefined()
    expect(configuration).not.toHaveProperty('credentialRef')
    const handle = await call<DatabaseQueryHandle>('database.startQuery', {
      project: projectId,
      connection: 'same-hmg',
      sql: 'SELECT id FROM approved.blocked',
      parameters: []
    })
    const result = await call<DatabaseQuerySnapshot>('database.waitQuery', {
      project: projectId,
      queryId: handle.queryId
    })
    expect(result).toMatchObject({
      status: 'completed',
      record: {
        queryId: handle.queryId,
        source: {
          connectionId: configuration.id,
          controllerRuntimeId: controller.getRuntimeId(),
          executionHostId: 'runtime:remote-a',
          alias: 'same-hmg'
        }
      },
      rows: [['7']]
    })
    const refused = await executorDispatcher.dispatch(
      {
        id: randomUUID(),
        authToken: 'fixture',
        method: 'database.waitBindingQuery',
        params: {
          credentialRef: binding.connection.credentialRef,
          controllerRuntimeId: controller.getRuntimeId(),
          queryId: handle.queryId,
          project: binding.connection.projects[0],
          sessionId: 'trusted-local:runtime'
        }
      },
      {
        caller: { kind: 'paired-device', deviceId: 'stranger' },
        pairedDeviceId: 'stranger',
        authenticatedCallerFingerprint: 'another-principal',
        callerScope: { kind: 'runtime-paired', grants: [] },
        clientKind: 'runtime'
      }
    )
    expect(refused.ok).toBe(false)
  })

  it('does not publish a remote catalog entry when secure storage on that executor is unavailable', async () => {
    executorProfile.keyring.available = false
    try {
      await expect(
        call('database.save', {
          configuration: { ...configuration, id: undefined, alias: 'unavailable-hmg' },
          credentials: fixture.credentials
        })
      ).rejects.toThrow()
      expect(
        controllerProfile.store.getDatabaseCatalog().connections.map((item) => item.alias)
      ).toEqual(['same-hmg'])
    } finally {
      executorProfile.keyring.available = true
    }
  })

  it('expires disconnected remote work at the server deadline and never retries it locally', async () => {
    await fixture.admin.query('BEGIN; LOCK TABLE approved.blocked IN ACCESS EXCLUSIVE MODE')
    const handle = await call<DatabaseQueryHandle>('database.startQuery', {
      project: projectId,
      connection: 'same-hmg',
      sql: 'SELECT * FROM approved.blocked',
      parameters: []
    })
    try {
      await expect
        .poll(
          async () => {
            await fixture.admin.query('SELECT pg_stat_clear_snapshot()')
            return (
              await fixture.admin.query(
                "SELECT count(*) FROM pg_stat_activity WHERE usename = 'orca_reader' AND wait_event_type = 'Lock'"
              )
            ).rows[0].count
          },
          { timeout: 5000 }
        )
        .toBe('1')
      network.abort(new Error('Disconnected fixture runtime'))
      const result = await call<DatabaseQuerySnapshot>('database.waitQuery', {
        project: projectId,
        queryId: handle.queryId
      })
      expect(result).toMatchObject({
        status: 'failed',
        record: { source: { executionHostId: 'runtime:remote-a' } }
      })
      await expect
        .poll(
          async () => {
            await fixture.admin.query('SELECT pg_stat_clear_snapshot()')
            return (
              await fixture.admin.query(
                "SELECT count(*) FROM pg_stat_activity WHERE usename = 'orca_reader' AND state = 'active'"
              )
            ).rows[0].count
          },
          { timeout: 10000 }
        )
        .toBe('0')
      await expect
        .poll(
          () =>
            executorProfile.store
              .getDatabaseQueryHistory()
              .find((record) => record.queryId === handle.queryId)?.status,
          { timeout: 5000 }
        )
        .toBe('cancelled')
    } finally {
      await fixture.admin.query('ROLLBACK')
    }
    await expect
      .poll(
        async () =>
          (
            await fixture.admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE usename = 'orca_reader' AND state = 'active'"
            )
          ).rows[0].count,
        { timeout: 10000 }
      )
      .toBe('0')
  })
})
