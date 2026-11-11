import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseAdapter } from '../adapters/database-adapter'
import type { DatabaseProjectKey } from '../../../shared/database/database-contracts'
import { DatabaseCatalog } from '../catalog/database-catalog'
import { DatabaseCredentialStore } from '../credentials/database-credential-store'
import { createDatabaseTestProfile } from '../catalog/testing/database-profile-fixture'
import { DatabaseQueryService, type DatabaseActor } from './database-query-service'

const project: DatabaseProjectKey = {
  kind: 'repository',
  projectId: 'app',
  executionHostId: 'local'
}
const actor: DatabaseActor = {
  controllerRuntimeId: 'controller-a',
  project,
  sessionId: 'session-a',
  owner: false
}
const profiles: ReturnType<typeof createDatabaseTestProfile>[] = []
const services: DatabaseQueryService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(profiles.splice(0).map((profile) => profile.close()))
})

async function setup(adapter: DatabaseAdapter) {
  const profile = createDatabaseTestProfile()
  profiles.push(profile)
  const catalog = new DatabaseCatalog(profile.store)
  const credentials = new DatabaseCredentialStore(profile.store)
  for (const [id, alias, server] of [
    ['11111111-1111-4111-8111-111111111111', 'hmg', 'hmg-server'],
    ['22222222-2222-4222-8222-222222222222', 'prod', 'prod-server']
  ]) {
    const credentialRef = await credentials.enroll(id, { username: 'reader', password: 'secret' })
    await catalog.save({
      id,
      credentialRef,
      alias,
      displayName: alias,
      engine: 'postgres',
      environment: alias,
      executionHostId: 'local',
      projects: [project],
      endpoint: { server, port: 5432, database: 'app', tls: { enabled: true } }
    })
  }
  const service = new DatabaseQueryService({
    store: profile.store,
    catalog,
    credentials,
    controllerRuntimeId: 'controller-a',
    executionHostId: 'local',
    adapter: () => adapter
  })
  services.push(service)
  return { service, catalog, store: profile.store }
}

const fixtureAdapter: DatabaseAdapter = {
  preflight: async () => ({ serverVersion: 'fixture', readOnlyProfile: true }),
  describe: async () => ({ schemas: [], tables: [], columns: [], truncated: false }),
  execute: async (config, _credentials, _query, _parameters, sink) => {
    sink.columns([{ id: '0', name: 'server', databaseType: 'text' }])
    sink.row([config.endpoint.server])
  },
  dispose: async () => {}
}

describe('runtime database query ownership', () => {
  it('keeps an accepted query available when an activity observer disconnects', async () => {
    const { service } = await setup(fixtureAdapter)
    service.onChanged(() => {
      throw new Error('Observer disconnected')
    })
    const handle = await service.start(
      { connection: 'hmg', project, sql: 'SELECT 1', parameters: [] },
      actor
    )
    expect((await service.wait(handle.queryId, actor, new AbortController().signal)).status).toBe(
      'completed'
    )
  })
  it('reports an interrupted persisted execution without replaying SQL after restart', async () => {
    const { service, store } = await setup(fixtureAdapter)
    const handle = await service.start(
      { connection: 'hmg', project, sql: 'SELECT 1', parameters: [] },
      actor
    )
    await service.wait(handle.queryId, actor, new AbortController().signal)
    await service.dispose()
    const record = store.getDatabaseQueryHistory()[0]
    await store.saveDatabaseQueryRecord({ ...record, status: 'running', finishedAt: null })
    const result = service.result(handle.queryId, actor)
    expect(result.status).toBe('failed')
  })

  it('cancels a running query and keeps driver error details out of its record', async () => {
    let started!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const adapter: DatabaseAdapter = {
      ...fixtureAdapter,
      execute: async (_c, _s, _q, _p, _sink, signal) => {
        started()
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('password=seed-secret')), {
            once: true
          })
        )
      }
    }
    const { service } = await setup(adapter)
    const handle = await service.start(
      { connection: 'hmg', project, sql: 'SELECT 1', parameters: [] },
      actor
    )
    await running
    await service.cancel(handle.queryId, actor)
    const result = service.result(handle.queryId, actor)
    expect(result.status).toBe('cancelled')
    expect(JSON.stringify(result)).not.toContain('seed-secret')
  })
  it('keeps each execution and its result bound to its explicit environment', async () => {
    const { service } = await setup(fixtureAdapter)
    const first = await service.start(
      { connection: 'hmg', project, sql: 'SELECT 1', parameters: [] },
      actor
    )
    const second = await service.start(
      { connection: 'prod', project, sql: 'SELECT 1', parameters: [] },
      actor
    )
    const hmg = await service.wait(first.queryId, actor, new AbortController().signal)
    const prod = await service.wait(second.queryId, actor, new AbortController().signal)
    expect(hmg.status).toBe('completed')
    expect(prod.status).toBe('completed')
    if (hmg.status !== 'completed' || prod.status !== 'completed') {
      throw new Error('Expected completed fixture queries')
    }
    expect(hmg.rows).toEqual([['hmg-server']])
    expect(prod.rows).toEqual([['prod-server']])
    expect(service.result(first.queryId, actor).record.source.alias).toBe('hmg')
    service.closeSession('session-a')
    expect(service.result(first.queryId, actor).status).toBe('expired')
    expect(() => service.result(first.queryId, { ...actor, sessionId: 'other-session' })).toThrow()
    await expect(
      service.start({ connection: '', project, sql: 'SELECT 1', parameters: [] }, actor)
    ).rejects.toThrow()
  })

  it('rejects queued execution after an endpoint revision changes', async () => {
    let release!: () => void
    let signalBoth!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const both = new Promise<void>((resolve) => {
      signalBoth = resolve
    })
    let entered = 0
    const adapter: DatabaseAdapter = {
      ...fixtureAdapter,
      execute: async (...args) => {
        if (++entered === 2) {
          signalBoth()
        }
        await gate
        await fixtureAdapter.execute(...args)
      }
    }
    const { service, catalog } = await setup(adapter)
    const request = { connection: 'hmg', project, sql: 'SELECT 1', parameters: [] }
    const first = await service.start(request, actor)
    const second = await service.start(request, actor)
    await both
    const queued = await service.start(request, actor)
    const saved = catalog.resolve('hmg', project)
    await catalog.save(
      { ...saved, endpoint: { ...saved.endpoint, server: 'replacement-server' } },
      saved.revision
    )
    release()
    await service.wait(first.queryId, actor, new AbortController().signal)
    await service.wait(second.queryId, actor, new AbortController().signal)
    const result = await service.wait(queued.queryId, actor, new AbortController().signal)
    expect(result.status).toBe('failed')
    expect(result.record.source.connectionRevision).toBe(1)
  })

  it('bounds returned rows and rejects a mutation through the same execution service', async () => {
    const adapter: DatabaseAdapter = {
      ...fixtureAdapter,
      execute: async (_c, _s, _q, _p, sink) => {
        sink.columns([{ id: '0', name: 'id', databaseType: 'text' }])
        for (let row = 0; row < 2000; row++) {
          if (!sink.row([String(row)])) {
            break
          }
        }
      }
    }
    const { service } = await setup(adapter)
    const handle = await service.start(
      { connection: 'hmg', project, sql: 'SELECT 1', parameters: [] },
      actor
    )
    const result = await service.wait(handle.queryId, actor, new AbortController().signal)
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') {
      throw new Error('Expected completed fixture query')
    }
    expect(result.rowCount).toBe(1000)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(5 * 1024 * 1024)
    const mutation = await service.start(
      { connection: 'hmg', project, sql: 'DELETE FROM public.encomendas', parameters: [] },
      actor
    )
    expect((await service.wait(mutation.queryId, actor, new AbortController().signal)).status).toBe(
      'failed'
    )
  })
})
