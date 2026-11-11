import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../../persistence/loading-store/store'
import { createSqliteTestStore } from '../../persistence/persistence-test-harness'
import { DatabaseCatalog } from './database-catalog'
import { createDatabaseTestProfile } from './testing/database-profile-fixture'
import type { DatabaseProjectKey } from '../../../shared/database/database-contracts'

const opened: ReturnType<typeof createDatabaseTestProfile>[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((profile) => profile.close()))
})

const repository: DatabaseProjectKey = {
  kind: 'repository',
  projectId: 'invoicing',
  executionHostId: 'local'
}
const folder: DatabaseProjectKey = {
  kind: 'folder',
  projectId: 'support',
  executionHostId: 'local'
}
const input = {
  id: '11111111-1111-4111-8111-111111111111',
  credentialRef: '11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333',
  alias: 'faturacao-hmg',
  displayName: 'Invoicing staging',
  engine: 'postgres' as const,
  environment: 'staging',
  executionHostId: 'local' as const,
  projects: [repository, folder],
  endpoint: {
    server: 'localhost',
    port: 5432,
    database: 'invoicing',
    tls: { enabled: true as const }
  }
}

function openCatalog() {
  const profile = createDatabaseTestProfile()
  opened.push(profile)
  return { ...profile, catalog: new DatabaseCatalog(profile.store) }
}

describe('global database connection catalog', () => {
  it('refuses a SQL Server certificate-trust option on another engine', async () => {
    const { catalog } = openCatalog()
    await expect(
      catalog.save({
        ...input,
        endpoint: { ...input.endpoint, tls: { enabled: true, trustServerCertificate: true } }
      })
    ).rejects.toThrow()
  })
  it('refuses a private key in the public certificate field before catalog persistence', async () => {
    const { catalog, store } = openCatalog()
    await expect(
      catalog.save({
        ...input,
        endpoint: {
          ...input.endpoint,
          tls: {
            enabled: true,
            caCertificate:
              '-----BEGIN PRIVATE KEY-----\nZGlzcG9zYWJsZQ==\n-----END PRIVATE KEY-----'
          }
        }
      })
    ).rejects.toThrow()
    expect(store.getDatabaseCatalog().connections).toEqual([])
  })
  it('persists a connection shared by a repository and a folder without publishing credentials', async () => {
    const { store, catalog, dataFile } = openCatalog()
    await catalog.save(input)
    expect(catalog.resolve('@faturacao-hmg', folder).id).toBe(
      '11111111-1111-4111-8111-111111111111'
    )
    expect(catalog.list(repository).map((c) => c.alias)).toEqual(['faturacao-hmg'])
    expect(catalog.list(folder).map((c) => c.alias)).toEqual(['faturacao-hmg'])
    expect(catalog.list(repository)[0]).not.toHaveProperty('credentialRef')
    expect(catalog.list(repository)[0]).not.toHaveProperty('endpoint')
    await store.freezeWritesAsync()
    const restored = createSqliteTestStore(Store, { dataFile })
    expect(new DatabaseCatalog(restored).resolve('faturacao-hmg', repository).environment).toBe(
      'staging'
    )
    await restored.freezeWritesAsync()
  })

  it('refuses unknown or unassociated selectors instead of choosing a different environment', async () => {
    const { catalog } = openCatalog()
    await catalog.save(input)
    expect(() => catalog.resolve('faturacao-prod', repository)).toThrow()
    expect(() => catalog.resolve('faturacao-hmg', { ...repository, projectId: 'other' })).toThrow()
    expect(() =>
      catalog.resolve('faturacao-hmg', { ...repository, executionHostId: 'ssh:other' })
    ).toThrow()
  })

  it('refuses duplicate aliases and stale edits while keeping the saved endpoint', async () => {
    const { catalog } = openCatalog()
    const saved = await catalog.save(input)
    await expect(
      catalog.save({
        ...input,
        id: '22222222-2222-4222-8222-222222222222',
        credentialRef: '22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
        alias: 'FATURACAO-HMG'
      })
    ).rejects.toThrow()
    await catalog.save({ ...input, environment: 'validation' }, saved.revision)
    await expect(
      catalog.save(
        { ...input, endpoint: { ...input.endpoint, server: 'wrong-host' } },
        saved.revision
      )
    ).rejects.toThrow()
    expect(catalog.getConfiguration(input.id).endpoint.server).toBe('localhost')
    expect(catalog.resolve('faturacao-hmg', repository).environment).toBe('validation')
  })

  it('does not recycle a renamed or removed alias for another connection', async () => {
    const { catalog } = openCatalog()
    const first = await catalog.save(input)
    const renamed = await catalog.save({ ...input, alias: 'faturacao-staging' }, first.revision)
    expect(() => catalog.resolve('faturacao-hmg', repository)).toThrow()
    await expect(
      catalog.save({ ...input, id: '22222222-2222-4222-8222-222222222222' })
    ).rejects.toThrow()
    await catalog.remove(renamed.id, renamed.revision)
    await expect(catalog.save({ ...input, alias: 'faturacao-staging' })).rejects.toThrow()
  })
})
