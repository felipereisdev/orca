import {
  databaseExplorerReferenceSchema as reference,
  databaseExplorerReference
} from '../../../../shared/database/database-explorer-reference'
import { useAppStore } from '@/store'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import type { DatabaseConnectionRef } from '../../../../shared/database/database-contracts'
import { openContentTabThroughLayoutOwner } from '@/runtime/workspace-layout/intents/layout-owner-content-tab-open'
import { createDatabaseExplorerState } from '@/components/database/database-explorer-state'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'

const explorers = new Map<string, ReturnType<typeof createDatabaseExplorerState>>()
export function databaseExplorerState(worktreeId: string, entityId: string) {
  const key = JSON.stringify([worktreeId, entityId])
  let state = explorers.get(key)
  if (!state) {
    state = createDatabaseExplorerState(databaseExplorerReference(entityId))
    explorers.set(key, state)
  }
  return state
}
let queryOpenVersion = 0
const requestedQueries = new Map<string, { queryId: string; version: number; sessionId?: string }>()
const listeners = new Set<() => void>()
export const subscribeDatabaseQueryOpen = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const requestedDatabaseQuery = (worktreeId: string, entityId: string) =>
  requestedQueries.get(JSON.stringify([worktreeId, entityId])) ?? null
export function openDatabaseExplorer({
  worktreeId,
  groupId,
  connection,
  queryId,
  sessionId
}: {
  worktreeId: string
  groupId?: string
  connection: DatabaseConnectionRef
  queryId?: string
  sessionId?: string
}) {
  const entityId = JSON.stringify(reference.parse(connection))
  if (queryId) {
    requestedQueries.set(JSON.stringify([worktreeId, entityId]), {
      queryId,
      version: ++queryOpenVersion,
      ...(sessionId ? { sessionId } : {})
    })
    listeners.forEach((listener) => listener())
  }
  const state = useAppStore.getState()
  const existing = state.unifiedTabsByWorktree[worktreeId]?.find(
    (tab) => tab.contentType === 'database' && tab.entityId === entityId
  )
  if (existing) {
    state.focusGroup(worktreeId, existing.groupId)
    state.activateTab(existing.id, { worktreeId })
    return
  }
  const tabId = createNonSecureContextUuid()
  const label = '@database'
  const drawHere = () =>
    state.createUnifiedTab(worktreeId, 'database', {
      id: tabId,
      entityId,
      label,
      targetGroupId: groupId
    }).id
  if (
    !ORCA_LAYOUT_OWNER_IS_MAIN ||
    !openContentTabThroughLayoutOwner(state, {
      worktreeId,
      entityId,
      command: {
        type: 'openDatabaseTab',
        tabId,
        entityId,
        groupId: groupId ?? state.activeGroupIdByWorktree[worktreeId]
      },
      facts: { label },
      shown: (id) => useAppStore.getState().activateTab(id, { worktreeId }),
      drawHere
    })
  ) {
    drawHere()
  }
}
