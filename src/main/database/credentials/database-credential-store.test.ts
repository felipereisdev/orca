import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseCredentialStore } from './database-credential-store'
import { DatabaseCatalog } from '../catalog/database-catalog'
import { createDatabaseTestProfile } from '../catalog/testing/database-profile-fixture'
import { readPersistedStateJson } from '../../persistence/persistence-test-harness'

const opened: ReturnType<typeof createDatabaseTestProfile>[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((profile) => profile.close()))
})

function openCredentials() {
  const profile = createDatabaseTestProfile()
  opened.push(profile)
  return { ...profile, credentials: new DatabaseCredentialStore(profile.store) }
}

describe('host-local database credentials', () => {
  it('keeps the prior credential available until a staged replacement is published', async () => {
    const { credentials } = openCredentials()
    const id = '11111111-1111-4111-8111-111111111111'
    const previous = await credentials.enroll(id, { username: 'reader', password: 'old-secret' })
    const staged = await credentials.enroll(id, { username: 'reader', password: 'new-secret' })
    expect(await credentials.read(previous)).toEqual({ username: 'reader', password: 'old-secret' })
    expect(await credentials.read(staged)).toEqual({ username: 'reader', password: 'new-secret' })
    await credentials.remove(staged)
    expect(await credentials.read(previous)).toEqual({ username: 'reader', password: 'old-secret' })
  })
  it('refuses enrollment without sealing and never writes plaintext', async () => {
    const { store, credentials, keyring, dataFile } = openCredentials()
    store.flushOrThrow()
    keyring.available = false
    await expect(
      credentials.enroll('11111111-1111-4111-8111-111111111111', {
        username: 'reader',
        password: 'seed-secret'
      })
    ).rejects.toThrow()
    expect(readPersistedStateJson(dataFile)).not.toContain('seed-secret')
  })

  it('preserves sealed credentials through an unrelated edit while the keyring is unavailable', async () => {
    const { store, credentials, keyring, dataFile } = openCredentials()
    const id = '11111111-1111-4111-8111-111111111111'
    const ref = await credentials.enroll(id, { username: 'reader', password: 'seed-secret' })
    const catalog = new DatabaseCatalog(store)
    const saved = await catalog.save({
      id,
      credentialRef: ref,
      alias: 'staging',
      displayName: 'Staging',
      engine: 'postgres',
      environment: 'staging',
      executionHostId: 'local',
      projects: [],
      endpoint: { server: 'localhost', port: 5432, database: 'app', tls: { enabled: true } }
    })
    const before = readPersistedStateJson(dataFile)
    expect(before).not.toContain('seed-secret')
    keyring.available = false
    await catalog.save({ ...saved, displayName: 'Renamed connection' }, saved.revision)
    await expect(credentials.read(ref)).rejects.toThrow()
    keyring.available = true
    expect(await credentials.read(ref)).toEqual({ username: 'reader', password: 'seed-secret' })
    expect(JSON.stringify(catalog.getConfiguration(id))).not.toContain('seed-secret')
    await credentials.remove(ref)
    await expect(credentials.read(ref)).rejects.toThrow()
  })
})
