import type { DatabaseCatalogState } from '../../../shared/database/database-contracts'
import type { DatabaseQueryRecord } from '../../../shared/database/database-query-contracts'
import type { DatabaseExecutionBinding } from '../../../shared/database/database-execution-binding'
import { parseDatabaseCatalog } from '../../database/catalog/database-catalog-validation'
import type { StoreRuntimeState } from './store-runtime-state'
import type { PrimaryStateWriteOperations } from './profile-writing/primary-state-writes'

function retainedHistory(records: DatabaseQueryRecord[]): DatabaseQueryRecord[] {
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000
  return records.filter((record) => record.createdAt >= cutoff)
}

type DatabasePersistenceRuntime = Pick<StoreRuntimeState, 'state' | 'dirtyProfileStateDomains'>
type CatalogChange<T> = { state: DatabaseCatalogState; value: T }
const context = Symbol('DatabasePersistence')

export class DatabasePersistence {
  readonly [context]: {
    runtime: DatabasePersistenceRuntime
    writes: PrimaryStateWriteOperations
    pruning?: Promise<void>
  }

  constructor(runtime: DatabasePersistenceRuntime, writes: PrimaryStateWriteOperations) {
    this[context] = { runtime, writes }
  }

  getDatabaseCatalog(): DatabaseCatalogState {
    return parseDatabaseCatalog(this[context].runtime.state.databaseCatalog)
  }

  getDatabaseExecutionBindings(): DatabaseExecutionBinding[] {
    return structuredClone(this[context].runtime.state.databaseExecutionBindings ?? [])
  }

  async addDatabaseExecutionBinding(binding: DatabaseExecutionBinding): Promise<void> {
    const { runtime, writes } = this[context]
    const accepted = await writes.runDurableMutation(() => {
      const previous = runtime.state.databaseExecutionBindings
      if (
        (previous?.length ?? 0) >= 2000 ||
        previous?.some((item) => item.connection.credentialRef === binding.connection.credentialRef)
      ) {
        return { value: false, persist: false }
      }
      runtime.state.databaseExecutionBindings = [...(previous ?? []), structuredClone(binding)]
      runtime.dirtyProfileStateDomains?.add('databaseExecutionBindings')
      return {
        value: true,
        persist: true,
        rollback: () => {
          runtime.state.databaseExecutionBindings = previous
        }
      }
    })
    if (!accepted) {
      throw new Error('Database execution binding could not be registered')
    }
  }

  async removeDatabaseExecutionBinding(binding: DatabaseExecutionBinding): Promise<void> {
    const { runtime, writes } = this[context]
    await writes.runDurableMutation(() => {
      const previous = runtime.state.databaseExecutionBindings
      runtime.state.databaseExecutionBindings = (previous ?? []).filter(
        (item) =>
          item.principalId !== binding.principalId ||
          item.controllerRuntimeId !== binding.controllerRuntimeId ||
          item.connection.credentialRef !== binding.connection.credentialRef ||
          item.connection.executionHostId !== binding.connection.executionHostId
      )
      runtime.dirtyProfileStateDomains?.add('databaseExecutionBindings')
      return {
        value: undefined,
        persist: true,
        rollback: () => {
          runtime.state.databaseExecutionBindings = previous
        }
      }
    })
  }

  getDatabaseQueryHistory(): DatabaseQueryRecord[] {
    const state = this[context]
    const all = state.runtime.state.databaseQueryHistory ?? []
    const visible = retainedHistory(all)
    if (visible.length !== all.length && !state.pruning) {
      state.pruning = this.removeDatabaseQueryRecords([])
        .catch(() => {})
        .finally(() => {
          state.pruning = undefined
        })
    }
    return structuredClone(visible)
  }

  async removeDatabaseQueryRecords(records: readonly DatabaseQueryRecord[]): Promise<void> {
    const removed = new Map(records.map((record) => [record.queryId, record]))
    const { runtime, writes } = this[context]
    await writes.runDurableMutation(() => {
      const previous = runtime.state.databaseQueryHistory
      runtime.state.databaseQueryHistory = retainedHistory(previous ?? []).filter(
        (record) =>
          !(
            removed.get(record.queryId)?.source.controllerRuntimeId ===
              record.source.controllerRuntimeId &&
            removed.get(record.queryId)?.project.executionHostId === record.project.executionHostId
          )
      )
      runtime.dirtyProfileStateDomains?.add('databaseQueryHistory')
      return {
        value: undefined,
        persist: true,
        rollback: () => {
          runtime.state.databaseQueryHistory = previous
        }
      }
    })
  }

  saveDatabaseQueryRecord(record: DatabaseQueryRecord): Promise<void> {
    const { runtime, writes } = this[context]
    return writes.runDurableMutation(() => {
      const previous = runtime.state.databaseQueryHistory
      const entries = retainedHistory([
        record,
        ...(previous ?? []).filter((item) => item.queryId !== record.queryId)
      ]).sort((a, b) => b.createdAt - a.createdAt)
      const counts = new Map<string, number>()
      const next: DatabaseQueryRecord[] = []
      let bytes = 0
      for (const entry of entries) {
        const count = counts.get(entry.source.connectionId) ?? 0
        if (count >= 100 || next.length >= 1000) {
          continue
        }
        const size = Buffer.byteLength(JSON.stringify(entry))
        if (bytes + size > 16 * 1024 * 1024) {
          continue
        }
        bytes += size
        counts.set(entry.source.connectionId, count + 1)
        next.push(entry)
      }
      runtime.state.databaseQueryHistory = next
      runtime.dirtyProfileStateDomains?.add('databaseQueryHistory')
      return {
        value: undefined,
        rollback: () => {
          runtime.state.databaseQueryHistory = previous
        }
      }
    })
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
