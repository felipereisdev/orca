import type { RuntimeMobileSessionDatabaseTab } from '../../../../shared/remote-runtime/session-graph/runtime-mobile-session-tab-contracts'
import type { Tab } from '../../../../shared/workspace-layout/tab-groups/tab-types'
import type { MobileSessionWorktreeInputs } from './types'

/** A database explorer tab as phones list it; none for any other tab. */
export function buildMobileDatabaseTab(
  inputs: Pick<MobileSessionWorktreeInputs, 'groups' | 'activeGroupId'>,
  tab: Tab | undefined
): RuntimeMobileSessionDatabaseTab[] {
  if (tab?.contentType !== 'database') {
    return []
  }
  return [
    {
      type: 'database',
      id: tab.id,
      entityId: tab.entityId,
      title: tab.customLabel?.trim() || tab.label || '@database',
      color: tab.color,
      isPinned: tab.isPinned,
      isActive: inputs.groups.some(
        (group) => group.id === inputs.activeGroupId && group.activeTabId === tab.id
      )
    }
  ]
}
