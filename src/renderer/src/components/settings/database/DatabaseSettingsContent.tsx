import { useMemo } from 'react'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { createDatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import { DatabaseConnectionsPane } from './DatabaseConnectionsPane'

export function DatabaseSettingsContent({ target }: { target: RuntimeClientTarget }) {
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  const client = useMemo(
    () =>
      createDatabaseRuntimeClient(
        environmentId ? { kind: 'environment', environmentId } : { kind: 'local' }
      ),
    [environmentId]
  )
  return <DatabaseConnectionsPane client={client} />
}
