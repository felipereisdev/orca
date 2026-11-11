import { DatabaseOperationError } from '../../../shared/database/database-operation-error'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { getSecretStore } from '../../../shared/secret-store'
import { ProtectedSecretPersistence } from '../../credentials/protected-secret-persistence'
import type { DatabaseCredentials } from '../../../shared/database/database-contracts'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'
import { databaseConnectionId, databaseCredentialRef } from '../catalog/database-catalog-validation'

const credential = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(8192)
})

export class DatabaseCredentialStore {
  private readonly secrets = new ProtectedSecretPersistence()

  constructor(
    private readonly persistence: Pick<
      DatabasePersistence,
      'getDatabaseCredential' | 'setDatabaseCredential'
    >
  ) {}

  async enroll(connectionId: string, credentials: DatabaseCredentials): Promise<string> {
    const ref = `${databaseConnectionId.parse(connectionId)}:${randomUUID()}`
    const value = credential.parse(credentials)
    const keyring = getSecretStore()
    if (!keyring.isEncryptionAvailable() || keyring.describeProtectionGap() !== null) {
      throw new DatabaseOperationError('database_credential_storage_unavailable')
    }
    const encrypted = this.secrets.encrypt(`databaseCredential:${ref}`, JSON.stringify(value))
    if (encrypted.degraded || !encrypted.blob) {
      throw new Error('Database credentials could not be protected')
    }
    await this.persistence.setDatabaseCredential(ref, encrypted.blob)
    if (encrypted.retentionUpdate) {
      this.secrets.commitRetentionUpdates([encrypted.retentionUpdate])
    }
    return ref
  }

  async read(ref: string): Promise<DatabaseCredentials> {
    databaseCredentialRef.parse(ref)
    const blob = this.persistence.getDatabaseCredential(ref)
    if (!blob) {
      throw new Error('Database credentials are not configured on this execution host')
    }
    const decrypted = this.secrets.decryptWithStatus(`databaseCredential:${ref}`, blob)
    if (decrypted.status !== 'decrypted') {
      throw new Error('Database credentials cannot be unlocked on this execution host')
    }
    try {
      return credential.parse(JSON.parse(decrypted.plaintext))
    } catch {
      throw new Error('Stored database credentials are invalid; enroll them again')
    }
  }

  async remove(ref: string): Promise<void> {
    databaseCredentialRef.parse(ref)
    await this.persistence.setDatabaseCredential(ref, null)
    this.secrets.removeRetainedBlob(`databaseCredential:${ref}`)
  }
}
