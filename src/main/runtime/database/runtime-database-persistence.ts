import type { RuntimeStore } from '../construction/runtime-store-contract'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'

type DatabaseStore = Pick<
  DatabasePersistence,
  | 'getDatabaseExecutionBindings'
  | 'addDatabaseExecutionBinding'
  | 'removeDatabaseExecutionBinding'
  | 'getDatabaseCatalog'
  | 'mutateDatabaseCatalog'
  | 'getDatabaseCredential'
  | 'setDatabaseCredential'
  | 'getDatabaseQueryHistory'
  | 'saveDatabaseQueryRecord'
>

export function requireDatabasePersistence(store: RuntimeStore): DatabaseStore {
  if (
    !store.getDatabaseExecutionBindings ||
    !store.addDatabaseExecutionBinding ||
    !store.removeDatabaseExecutionBinding ||
    !store.getDatabaseCatalog ||
    !store.mutateDatabaseCatalog ||
    !store.getDatabaseCredential ||
    !store.setDatabaseCredential ||
    !store.getDatabaseQueryHistory ||
    !store.saveDatabaseQueryRecord
  ) {
    throw new Error('database_capability_missing')
  }
  return {
    getDatabaseExecutionBindings: store.getDatabaseExecutionBindings.bind(store),
    addDatabaseExecutionBinding: store.addDatabaseExecutionBinding.bind(store),
    removeDatabaseExecutionBinding: store.removeDatabaseExecutionBinding.bind(store),
    getDatabaseCatalog: store.getDatabaseCatalog.bind(store),
    mutateDatabaseCatalog: store.mutateDatabaseCatalog.bind(store),
    getDatabaseCredential: store.getDatabaseCredential.bind(store),
    setDatabaseCredential: store.setDatabaseCredential.bind(store),
    getDatabaseQueryHistory: store.getDatabaseQueryHistory.bind(store),
    saveDatabaseQueryRecord: store.saveDatabaseQueryRecord.bind(store)
  }
}
