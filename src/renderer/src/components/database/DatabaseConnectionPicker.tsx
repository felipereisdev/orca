import { useEffect, useState } from 'react'
import { openDatabaseExplorer } from '@/lib/database/database-explorer-tabs'
import {
  subscribeDatabaseConnectionPicker,
  type DatabaseConnectionPickerRequest
} from '@/lib/database/database-connection-picker-request'
import { DatabaseConnectionPickerDialog } from './DatabaseConnectionPickerDialog'
import {
  useWorkspaceDatabaseClient,
  useWorkspaceDatabaseConnections
} from './use-workspace-database-connections'

// Why: a quick load that ends in a single connection opens it directly, so don't flash the dialog first.
const SHOW_LOADING_AFTER_MS = 200

function openConnection(
  request: DatabaseConnectionPickerRequest,
  connectionId: string,
  controllerRuntimeId: string
): void {
  openDatabaseExplorer({
    worktreeId: request.worktreeId,
    groupId: request.groupId,
    connection: { connectionId, controllerRuntimeId }
  })
}

/** Answers the + menu's database icon: the only connection opens directly, several open a picker. */
export function DatabaseConnectionPicker(): React.JSX.Element {
  const [request, setRequest] = useState<DatabaseConnectionPickerRequest | null>(null)
  const [slowRequestId, setSlowRequestId] = useState<number | null>(null)
  // Why: closing keeps the request so the dialog's exit animation still shows its connections.
  const [doneRequestId, setDoneRequestId] = useState<number | null>(null)
  const pending = request !== null && request.id !== doneRequestId
  const client = useWorkspaceDatabaseClient(request?.worktreeId ?? null)
  const connections = useWorkspaceDatabaseConnections(
    client,
    request?.worktreeId ?? null,
    request?.id ?? null
  )
  const single = connections.status === 'ready' && connections.entries.length === 1
  useEffect(() => subscribeDatabaseConnectionPicker(setRequest), [])
  useEffect(() => {
    if (!request) {
      return
    }
    const timer = window.setTimeout(() => setSlowRequestId(request.id), SHOW_LOADING_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [request])
  useEffect(() => {
    if (request && pending && single && connections.status === 'ready') {
      openConnection(request, connections.entries[0].id, connections.controllerRuntimeId)
      setDoneRequestId(request.id)
    }
  }, [connections, pending, request, single])

  return (
    <DatabaseConnectionPickerDialog
      open={
        pending &&
        client !== null &&
        !single &&
        (connections.status !== 'loading' || slowRequestId === request.id)
      }
      connections={connections}
      onOpenChange={(next) => {
        if (!next && request) {
          setDoneRequestId(request.id)
        }
      }}
      onSelect={(connection) => {
        if (request && connections.status === 'ready') {
          openConnection(request, connection.id, connections.controllerRuntimeId)
          setDoneRequestId(request.id)
        }
      }}
    />
  )
}
