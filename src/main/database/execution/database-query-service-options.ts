import type { ExecutionHostId } from '../../../shared/execution-host'
import type { DatabaseEngine } from '../../../shared/database/database-contracts'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'
import type { DatabaseAdapter } from '../adapters/database-adapter'
import type { DatabaseCatalog } from '../catalog/database-catalog'
import type { DatabaseCredentialStore } from '../credentials/database-credential-store'
import type { DatabaseQueryAdmission } from './database-query-admission'
import type { DatabaseQueryRecords } from './database-query-records'
import type { DatabaseRemoteExecution } from './database-query-executor'

export type DatabaseQueryServiceOptions = {
  store: Pick<
    DatabasePersistence,
    'getDatabaseQueryHistory' | 'saveDatabaseQueryRecord' | 'removeDatabaseQueryRecords'
  >
  catalog: Pick<DatabaseCatalog, 'resolve'>
  credentials: Pick<DatabaseCredentialStore, 'read'>
  controllerRuntimeId: string
  executionHostId: ExecutionHostId
  adapter(engine: DatabaseEngine): DatabaseAdapter | undefined
  admission?: DatabaseQueryAdmission
  records?: DatabaseQueryRecords
  remoteExecution?: DatabaseRemoteExecution
}
