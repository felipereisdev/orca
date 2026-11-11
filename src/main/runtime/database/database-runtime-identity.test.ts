import { expect, it } from 'vitest'
import { z } from 'zod'
import { createDatabaseTestProfile } from '../../database/catalog/testing/database-profile-fixture'
import { createSqliteTestStore } from '../../persistence/persistence-test-harness'
import { Store } from '../../persistence/loading-store/store'
import { OrcaRuntimeService } from '../orca-runtime'
import { RpcDispatcher } from '../rpc/dispatcher'
import { DATABASE_METHODS } from '../rpc/methods/database/database'
import { disposeRuntimeDatabase } from './runtime-database-service-slot'
import { databaseQueryRecordSchema } from '../../../shared/database/database-query-result-schema'

it('restores controller references and history after reopening the profile and can erase old SQL', async () => {
  const profile = createDatabaseTestProfile()
  let store = profile.store
  let runtime = new OrcaRuntimeService(store)
  const call = async (method: string, params?: unknown) => {
    const response = await new RpcDispatcher({ runtime, methods: DATABASE_METHODS }).dispatch({
      id: 'identity-test',
      authToken: 'fixture',
      method,
      params
    })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result
  }
  try {
    const group = store.createProjectGroup({ name: 'Notes', createdFrom: 'manual' })
    const folder = store.createFolderWorkspace({
      projectGroupId: group.id,
      folderPath: '/fixture/notes'
    })
    const project = {
      kind: 'folder' as const,
      projectId: folder.id,
      executionHostId: 'local' as const
    }
    const identity = z
      .object({ controllerRuntimeId: z.string().min(1) })
      .parse(await call('database.executionCapabilities')).controllerRuntimeId
    const connection = z.object({ id: z.string() }).parse(
      await call('database.save', {
        configuration: {
          alias: 'restart-hmg',
          displayName: 'Restart',
          engine: 'postgres',
          environment: 'hmg',
          executionHostId: 'local',
          projects: [project],
          endpoint: {
            server: 'localhost',
            port: 5432,
            database: 'fixture',
            tls: { enabled: true }
          }
        },
        credentials: { username: 'reader', password: 'disposable' }
      })
    )
    await store.saveDatabaseQueryRecord({
      queryId: '11111111-1111-4111-8111-111111111112',
      source: {
        connectionId: connection.id,
        connectionRevision: 1,
        alias: 'restart-hmg',
        environment: 'hmg',
        engine: 'postgres',
        executionHostId: 'local',
        controllerRuntimeId: identity
      },
      project,
      sessionId: null,
      sql: 'SELECT 7',
      parameterNames: [],
      createdAt: Date.now(),
      finishedAt: Date.now(),
      status: 'completed',
      rowCount: 1,
      truncated: false
    })
    await disposeRuntimeDatabase(runtime)
    await store.freezeWritesAsync()
    store = createSqliteTestStore(Store, { dataFile: profile.dataFile })
    runtime = new OrcaRuntimeService(store)
    expect(
      z
        .object({ controllerRuntimeId: z.string() })
        .parse(await call('database.executionCapabilities')).controllerRuntimeId
    ).toBe(identity)
    expect(
      z
        .array(databaseQueryRecordSchema)
        .parse(await call('database.queryHistory', { project: folder.id }))
        .map((record) => record.sql)
    ).toEqual(['SELECT 7'])
    const mentions = await call('database.resolveMentions', {
      project: folder.id,
      references: [
        {
          kind: 'database',
          connectionId: connection.id,
          controllerRuntimeId: identity,
          aliasAtSelection: 'restart-hmg'
        }
      ]
    })
    expect(z.array(z.object({ alias: z.string() })).parse(mentions)).toEqual([
      expect.objectContaining({ alias: 'restart-hmg' })
    ])
    await call('database.clearHistory', { connectionId: connection.id })
    expect(store.getDatabaseQueryHistory()).toEqual([])
  } finally {
    await disposeRuntimeDatabase(runtime)
    await store.freezeWritesAsync()
    await profile.close()
  }
})
