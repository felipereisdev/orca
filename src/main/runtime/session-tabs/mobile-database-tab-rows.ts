import type { RuntimeMobileSessionDatabaseTab } from '../../../shared/runtime-mobile-session-tab-contracts'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'

export function buildHeadlessMobileDatabaseTabs(
  worktreeId: string,
  session: WorkspaceSessionState
): RuntimeMobileSessionDatabaseTab[] {
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
