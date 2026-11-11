import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../../persistence/loading-store/store'
import { createSqliteTestStore } from '../../../persistence/persistence-test-harness'
import { setSecretStore } from '../../../../shared/secret-store'

export function createDatabaseTestProfile() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-database-profile-'))
  const keyring = { available: true }
  const installKeyring = () =>
    setSecretStore({
      isEncryptionAvailable: () => keyring.available,
      encryptString: (value) => Buffer.from(`sealed:${value}`),
      decryptString: (value) => value.toString().slice('sealed:'.length),
      describeProtectionGap: () => null
    })
  installKeyring()
  const dataFile = join(directory, 'state.json')
  const store = createSqliteTestStore(Store, { dataFile })
  return {
    store,
    keyring,
    installKeyring,
    dataFile,
    async close() {
      await store.freezeWritesAsync()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
