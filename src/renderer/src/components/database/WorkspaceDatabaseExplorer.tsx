import { useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { runtimeTargetForWorkspaceOwner } from '@/lib/workspace/ownership/resolve-owner'
import { createDatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import {
  databaseExplorerState,
  requestedDatabaseQuery,
  subscribeDatabaseQueryOpen
} from '@/lib/database/database-explorer-tabs'
import { DatabaseExplorerPane } from './DatabaseExplorerPane'
import { useTranslate } from '@/i18n/use-translate'
export default function WorkspaceDatabaseExplorer({
  worktreeId,
  entityId
}: {
  worktreeId: string
  entityId: string
}) {
  const t = useTranslate()
  const target = useAppStore(
    useShallow((state) => runtimeTargetForWorkspaceOwner(state, { workspaceId: worktreeId }))
  )
  const controller = useMemo(
    () => databaseExplorerState(worktreeId, entityId),
    [worktreeId, entityId]
  )
  const client = useMemo(() => target && createDatabaseRuntimeClient(target), [target])
  const queryId = useSyncExternalStore(subscribeDatabaseQueryOpen, () =>
    requestedDatabaseQuery(worktreeId, entityId)
  )
  if (!client) {
    return (
      <p role="alert" className="p-4 text-xs text-muted-foreground">
        {t('database.explorer.ownerUnavailable', 'The workspace host is unavailable')}
      </p>
    )
  }
  return (
    <DatabaseExplorerPane
      key={entityId}
      entityId={entityId}
      client={client}
      controller={controller}
      worktreeId={worktreeId}
      requestedQuery={queryId?.queryId ?? null}
      requestedVersion={queryId?.version}
      requestedSessionId={queryId?.sessionId}
    />
  )
}
