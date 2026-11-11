import type {
  DatabaseConnection,
  DatabaseCredentials
} from '../../../shared/database/database-contracts'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'
import type { DatabaseCredentialStore } from '../credentials/database-credential-store'
import { parseDatabaseConnection } from '../catalog/database-catalog-validation'

export class DatabaseExecutionBindings {
  constructor(
    private readonly store: Pick<
      DatabasePersistence,
      | 'getDatabaseExecutionBindings'
      | 'addDatabaseExecutionBinding'
      | 'removeDatabaseExecutionBinding'
    >,
    private readonly credentials: DatabaseCredentialStore
  ) {}

  read(principalId: string, credentialRef: string) {
    const binding = this.store
      .getDatabaseExecutionBindings()
      .find(
        (item) =>
          item.principalId === principalId && item.connection.credentialRef === credentialRef
      )
    if (!binding) {
      throw new Error('Database execution binding is unavailable to this controller')
    }
    return { ...binding, connection: parseDatabaseConnection(binding.connection) }
  }

  async enroll(
    principalId: string,
    controllerRuntimeId: string,
    configuration: DatabaseConnection,
    credentials?: DatabaseCredentials,
    previousCredentialRef?: string
  ) {
    const parsed = parseDatabaseConnection(configuration)
    const previous = previousCredentialRef
      ? this.read(principalId, previousCredentialRef)
      : undefined
    if (previous && previous.connection.id !== parsed.id) {
      throw new Error('Database credential belongs to another connection')
    }
    const value =
      credentials ??
      (previous ? await this.credentials.read(previous.connection.credentialRef) : undefined)
    if (!value) {
      throw new Error('Database execution binding requires protected credentials')
    }
    const credentialRef = await this.credentials.enroll(parsed.id, value)
    try {
      await this.store.addDatabaseExecutionBinding({
        principalId,
        controllerRuntimeId,
        connection: { ...parsed, credentialRef }
      })
    } catch (error) {
      await this.credentials.remove(credentialRef).catch(() => {})
      throw error
    }
    return { credentialRef }
  }

  async remove(principalId: string, credentialRef: string): Promise<void> {
    const binding = this.read(principalId, credentialRef)
    await this.store.removeDatabaseExecutionBinding(binding)
    await this.credentials.remove(credentialRef)
  }
}
