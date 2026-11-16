import type { RuntimeMobileSessionDatabaseTab } from '../../../shared/remote-runtime/session-graph/runtime-mobile-session-tab-contracts'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'

export function headlessMobileDatabaseTabs(
  worktreeId: string,
  session: WorkspaceSessionState,
  runtimeOwnedOnly = false
): RuntimeMobileSessionDatabaseTab[] {
  if (runtimeOwnedOnly) {
    return []
  }
  return (session.unifiedTabs?.[worktreeId] ?? []).flatMap((tab) =>
    tab.contentType === 'database'
      ? [
          {
            type: 'database',
            id: tab.id,
            entityId: tab.entityId,
            title: tab.customLabel?.trim() || tab.label || '@database',
            isActive: session.activeTabIdByWorktree?.[worktreeId] === tab.id
          }
        ]
      : []
  )
}
