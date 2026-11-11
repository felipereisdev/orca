import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  DatabaseConnectionInput,
  DatabaseCredentials
} from '../../../shared/database/database-contracts'
import type { DatabaseCatalog } from '../../database/catalog/database-catalog'
import { prepareDatabaseConnection } from '../../database/catalog/database-catalog'
import type { DatabaseCredentialStore } from '../../database/credentials/database-credential-store'
import type { DatabaseExecutionRouter } from '../../database/routing/database-execution-route'
import type { requireDatabasePersistence } from './runtime-database-persistence'
import { resolveDatabaseProject, type DatabaseRuntimeHost } from './database-project-context'
import { databaseCredentialRef } from '../../database/catalog/database-catalog-validation'

export class DatabaseConnectionWriter {
  constructor(
    private readonly runtime: DatabaseRuntimeHost,
    private readonly persistence: ReturnType<typeof requireDatabasePersistence>,
    private readonly catalog: DatabaseCatalog,
    private readonly credentials: DatabaseCredentialStore,
    private readonly router: DatabaseExecutionRouter,
    private readonly controllerRuntimeId: string
  ) {}

  async save(
    input: DatabaseConnectionInput,
    credentials?: DatabaseCredentials,
    expectedRevision?: number
  ) {
    const previous = input.id
      ? this.persistence.getDatabaseCatalog().connections.find((item) => item.id === input.id)
      : undefined
    if (previous && previous.executionHostId !== input.executionHostId) {
      throw new Error('Create a new connection when changing the execution host')
    }
    for (const project of input.projects) {
      const resolved = await resolveDatabaseProject(this.runtime, {
        project: project.projectId,
        executionHostId: project.executionHostId
      })
      if (resolved.kind !== project.kind || resolved.executionHostId !== project.executionHostId) {
        throw new Error('Database project association is unavailable')
      }
    }
    const id = input.id ?? randomUUID()
    const configuration = prepareDatabaseConnection(
      { ...input, id, credentialRef: `${id}:${randomUUID()}` },
      previous
    )
    const route = await this.router.routeHost(id, input.executionHostId, input.accessMode)
    let staged: string | undefined
    if (route.environmentId) {
      const receipt = z.object({ credentialRef: databaseCredentialRef }).parse(
        await this.router.call(route, 'database.enrollBinding', {
          configuration,
          credentials,
          controllerRuntimeId: this.controllerRuntimeId,
          previousCredentialRef: previous?.credentialRef
        })
      )
      staged = receipt.credentialRef
    } else if (credentials) {
      staged = await this.credentials.enroll(id, credentials)
    }
    const credentialRef = staged ?? previous?.credentialRef
    if (!credentialRef) {
      throw new Error('Database connection requires protected credentials')
    }
    const retire = (ref: string) =>
      route.environmentId
        ? this.router.call(route, 'database.removeBinding', {
            credentialRef: ref,
            controllerRuntimeId: this.controllerRuntimeId
          })
        : this.credentials.remove(ref)
    let saved
    try {
      saved = await this.catalog.save({ ...input, id, credentialRef }, expectedRevision)
    } catch (error) {
      if (staged) {
        await retire(staged).catch(() => {})
      }
      throw error
    }
    if (staged && previous) {
      await retire(previous.credentialRef).catch(() => {})
    }
    return this.catalog.getConfiguration(saved.id)
  }

  async remove(id: string, revision: number, afterRemoval?: () => Promise<void>) {
    const previous = this.persistence
      .getDatabaseCatalog()
      .connections.find((item) => item.id === id)
    if (!previous) {
      throw new Error('Database connection was not found')
    }
    const route = await this.router.routeHost(id, previous.executionHostId)
    await this.catalog.remove(id, revision)
    try {
      await afterRemoval?.()
    } finally {
      await (route.environmentId
        ? this.router.call(route, 'database.removeBinding', {
            credentialRef: previous.credentialRef,
            controllerRuntimeId: this.controllerRuntimeId
          })
        : this.credentials.remove(previous.credentialRef))
    }
  }
}
