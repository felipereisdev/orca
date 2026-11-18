import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/** Opens the workspace's Desktop tab, or focuses it: a workspace has one environment desktop. */
export function openDesktopTab(worktreeId: string, groupId?: string): void {
  const state = useAppStore.getState()
  const existing = state.unifiedTabsByWorktree[worktreeId]?.find(
    (tab) => tab.contentType === 'desktop'
  )
  if (existing) {
    state.focusGroup(worktreeId, existing.groupId)
    state.activateTab(existing.id, { worktreeId })
    return
  }
  state.createUnifiedTab(worktreeId, 'desktop', {
    entityId: worktreeId,
    label: translate('desktop.tab.create', 'Desktop'),
    targetGroupId: groupId
  })
}
