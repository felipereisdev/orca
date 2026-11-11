import { randomUUID } from 'node:crypto'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'

export function databaseControllerIdentity(
  store: Pick<DatabasePersistence, 'getDatabaseCatalog' | 'mutateDatabaseCatalog'>
): Promise<string> {
  const saved = store.getDatabaseCatalog().controllerId
  if (saved) {
    return Promise.resolve(saved)
  }
  return store.mutateDatabaseCatalog((state) => {
    const controllerId = state.controllerId ?? randomUUID()
    return { state: { ...state, controllerId }, value: controllerId }
  })
}
