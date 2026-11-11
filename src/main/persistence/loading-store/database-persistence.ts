import type { DatabaseCatalogState } from '../../../shared/database/database-contracts'
import { parseDatabaseCatalog } from '../../database/catalog/database-catalog-validation'
import type { StoreRuntimeState } from './store-runtime-state'
import type { PrimaryStateWriteOperations } from './primary-state-writes'

type DatabasePersistenceRuntime = Pick<StoreRuntimeState, 'state' | 'dirtyProfileStateDomains'>
type CatalogChange<T> = { state: DatabaseCatalogState; value: T }
const context = Symbol('DatabasePersistence')

export class DatabasePersistence {
  readonly [context]: { runtime: DatabasePersistenceRuntime; writes: PrimaryStateWriteOperations }

  constructor(runtime: DatabasePersistenceRuntime, writes: PrimaryStateWriteOperations) {
    this[context] = { runtime, writes }
  }

  getDatabaseCatalog(): DatabaseCatalogState {
    return parseDatabaseCatalog(this[context].runtime.state.databaseCatalog)
  }

  async mutateDatabaseCatalog<T>(
    change: (state: DatabaseCatalogState) => CatalogChange<T>
  ): Promise<T> {
    const { runtime, writes } = this[context]
    const result = await writes.runDurableMutation<
      { ok: false; error: unknown } | { ok: true; value: T }
    >(() => {
      let next: CatalogChange<T>
      try {
        next = change(parseDatabaseCatalog(runtime.state.databaseCatalog))
        next.state = parseDatabaseCatalog(next.state)
      } catch (error) {
        return { value: { ok: false as const, error }, persist: false }
      }
      const previous = runtime.state.databaseCatalog
      runtime.state.databaseCatalog = next.state
      runtime.dirtyProfileStateDomains?.add('databaseCatalog')
      return {
        value: { ok: true as const, value: next.value },
        rollback: () => {
          runtime.state.databaseCatalog = previous
        }
      }
    })
    if (!result.ok) {
      throw result.error
    }
    return result.value
  }

  getDatabaseCredential(ref: string): string | undefined {
    return this[context].runtime.state.databaseCredentials?.[ref]
  }

  setDatabaseCredential(ref: string, sealed: string | null): Promise<void> {
    const { runtime, writes } = this[context]
    return writes.runDurableMutation(() => {
      const previous = runtime.state.databaseCredentials
      const next = { ...previous }
      if (sealed === null) {
        delete next[ref]
      } else {
        next[ref] = sealed
      }
      runtime.state.databaseCredentials = next
      runtime.dirtyProfileStateDomains?.add('databaseCredentials')
      return {
        value: undefined,
        rollback: () => {
          runtime.state.databaseCredentials = previous
        }
      }
    })
  }
}
