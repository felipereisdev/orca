import { afterEach, expect, it } from 'vitest'
import { createDatabaseTestProfile } from '../catalog/testing/database-profile-fixture'
import { DatabaseCredentialStore } from '../credentials/database-credential-store'
import { DatabaseExecutionBindings } from './database-execution-bindings'
import type { DatabaseConnection } from '../../../shared/database/database-contracts'

const profiles: ReturnType<typeof createDatabaseTestProfile>[] = []
afterEach(async () => {
  await Promise.all(profiles.splice(0).map((profile) => profile.close()))
})

it('enrolls a sealed execution binding without duplicating the global catalog and refuses other controllers', async () => {
  const profile = createDatabaseTestProfile()
  profiles.push(profile)
  const credentials = new DatabaseCredentialStore(profile.store)
  const bindings = new DatabaseExecutionBindings(profile.store, credentials)
  const configuration: DatabaseConnection = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    alias: 'hmg',
    displayName: 'HMG',
    engine: 'postgres',
    environment: 'hmg',
    executionHostId: 'runtime:remote-a',
    projects: [{ kind: 'folder', projectId: 'same-project', executionHostId: 'local' }],
    endpoint: { server: 'database', port: 5432, database: 'app', tls: { enabled: true } },
    limits: { timeoutMs: 30000, maxRows: 1000, maxOutputBytes: 5242880 },
    credentialRef: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222'
  }
  const receipt = await bindings.enroll('principal-a', 'controller-a', configuration, {
    username: 'reader',
    password: 'remote-only-password'
  })
  expect(profile.store.getDatabaseCatalog().connections).toEqual([])
  const registered = bindings.read('principal-a', receipt.credentialRef)
  expect(registered.connection.executionHostId).toBe('runtime:remote-a')
  expect(await credentials.read(receipt.credentialRef)).toEqual({
    username: 'reader',
    password: 'remote-only-password'
  })
  expect(() => bindings.read('principal-b', receipt.credentialRef)).toThrow()
  await expect(bindings.remove('principal-b', receipt.credentialRef)).rejects.toThrow()
  expect(JSON.stringify(profile.store.getDatabaseExecutionBindings())).not.toContain(
    'remote-only-password'
  )
})
