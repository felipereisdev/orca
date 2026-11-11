import type {
  DatabaseConnection,
  DatabaseConnectionConfiguration,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseProjectKey
} from '../../../shared/database/database-contracts'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'
import { databaseConnectionId, parseDatabaseConnection } from './database-catalog-validation'
import { sameDatabaseProject } from './database-project-scope'

export type DatabaseCatalogSaveInput = DatabaseConnectionInput & { credentialRef: string }

export class DatabaseCatalog {
  constructor(
    private readonly persistence: Pick<
      DatabasePersistence,
      'getDatabaseCatalog' | 'mutateDatabaseCatalog'
    >
  ) {}

  list(project?: DatabaseProjectKey): DatabaseConnectionSummary[] {
    return this.persistence
      .getDatabaseCatalog()
      .connections.filter(
        (connection) =>
          !project || connection.projects.some((item) => sameDatabaseProject(item, project))
      )
      .map(({ endpoint: _endpoint, credentialRef: _credential, ...summary }) => summary)
  }

  getConfiguration(id: string): DatabaseConnectionConfiguration {
    const item = this.persistence
      .getDatabaseCatalog()
      .connections.find((connection) => connection.id === id)
    if (!item) {
      throw new Error('Database connection was not found')
    }
    const { credentialRef: _credential, ...configuration } = item
    return { ...configuration, credentialConfigured: true }
  }

  resolve(selector: string, project: DatabaseProjectKey): DatabaseConnection {
    const normalized = selector.replace(/^@/, '').toLowerCase()
    const item = this.persistence
      .getDatabaseCatalog()
      .connections.find(
        (connection) =>
          (connection.id === selector || connection.alias === normalized) &&
          connection.projects.some((candidate) => sameDatabaseProject(candidate, project))
      )
    if (!item) {
      throw new Error('Database connection is unavailable in this project')
    }
    return item
  }

  save(input: DatabaseCatalogSaveInput, expectedRevision?: number): Promise<DatabaseConnection> {
    const id = databaseConnectionId.parse(input.id ?? input.credentialRef.split(':')[0])
    const alias = input.alias.trim().toLowerCase()
    if (databaseConnectionId.safeParse(alias).success) {
      return Promise.reject(new Error('Database aliases cannot be connection IDs'))
    }
    return this.persistence.mutateDatabaseCatalog((state) => {
      const previous = state.connections.find((connection) => connection.id === id)
      if (previous ? previous.revision !== expectedRevision : expectedRevision !== undefined) {
        throw new Error('Database connection changed; reload before saving')
      }
      if (
        state.retiredAliases.includes(alias) ||
        state.connections.some((connection) => connection.id !== id && connection.alias === alias)
      ) {
        throw new Error('Database connection alias is already in use or retired')
      }
      const connection = prepareDatabaseConnection({ ...input, id }, previous)
      if (previous && previous.executionHostId !== connection.executionHostId) {
        throw new Error('Create a connection with credentials enrolled on the new execution host')
      }
      if (previous && previous.alias !== alias) {
        state.retiredAliases.push(previous.alias)
      }
      state.connections = [...state.connections.filter((item) => item.id !== id), connection]
      return { state, value: connection }
    })
  }

  remove(id: string, expectedRevision: number): Promise<void> {
    return this.persistence.mutateDatabaseCatalog((state) => {
      const previous = state.connections.find((connection) => connection.id === id)
      if (!previous || previous.revision !== expectedRevision) {
        throw new Error('Database connection changed; reload before removing')
      }
      state.connections = state.connections.filter((connection) => connection.id !== id)
      state.retiredAliases = [...new Set([...state.retiredAliases, previous.alias])]
      return { state, value: undefined }
    })
  }
}

export function prepareDatabaseConnection(
  input: DatabaseCatalogSaveInput,
  previous?: DatabaseConnection
): DatabaseConnection {
  const id = databaseConnectionId.parse(input.id ?? input.credentialRef.split(':')[0])
  const alias = input.alias.trim().toLowerCase()
  if (databaseConnectionId.safeParse(alias).success) {
    throw new Error('Database aliases cannot be connection IDs')
  }
  return parseDatabaseConnection({
    ...input,
    id,
    alias,
    revision: (previous?.revision ?? 0) + 1,
    limits: {
      timeoutMs: 30000,
      maxRows: 1000,
      maxOutputBytes: 5 * 1024 * 1024,
      ...previous?.limits,
      ...input.limits
    }
  })
}
