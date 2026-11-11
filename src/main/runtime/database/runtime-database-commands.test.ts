import { afterEach, expect, it, vi } from 'vitest'
import { createDatabaseTestProfile } from '../../database/catalog/testing/database-profile-fixture'
import { RuntimeDatabaseCommands } from './runtime-database-commands'

const profiles: ReturnType<typeof createDatabaseTestProfile>[] = []
const controllers: RuntimeDatabaseCommands[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()))
  await Promise.all(profiles.splice(0).map((profile) => profile.close()))
})

it('keeps published replacement credentials usable when obsolete-secret cleanup fails', async () => {
  const profile = createDatabaseTestProfile()
  profiles.push(profile)
  const controller = new RuntimeDatabaseCommands(
    {
      requireStore: () => profile.store,
      getRuntimeId: () => 'runtime-a',
      listRepos: () => [],
      showManagedWorktree: async () => {
        throw new Error('No workspace selected')
      }
    },
    '11111111-1111-4111-8111-111111111111'
  )
  controllers.push(controller)
  const input = {
    alias: 'hmg',
    displayName: 'HMG',
    engine: 'postgres' as const,
    environment: 'hmg',
    executionHostId: 'local' as const,
    projects: [],
    endpoint: {
      server: 'localhost',
      port: 5432,
      database: 'fixture',
      tls: { enabled: true as const }
    }
  }
  const first = await controller.save(input, { username: 'reader', password: 'first-password' })
  const previousRef = profile.store.getDatabaseCatalog().connections[0].credentialRef
  const remove = controller.credentials.remove.bind(controller.credentials)
  vi.spyOn(controller.credentials, 'remove').mockImplementation((ref) =>
    ref === previousRef ? Promise.reject(new Error('Storage unavailable')) : remove(ref)
  )
  await controller
    .save(
      { ...input, id: first.id },
      { username: 'reader', password: 'replacement-password' },
      first.revision
    )
    .catch(() => {})
  const published = profile.store.getDatabaseCatalog().connections[0]
  expect(await controller.credentials.read(published.credentialRef)).toEqual({
    username: 'reader',
    password: 'replacement-password'
  })
})
