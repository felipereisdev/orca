import { OrcaRuntimeWithRefuseUnattributedMobileSessionTabClose } from './refuse-unattributed-mobile-session-tab-close'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { openMobileDatabaseTab } from '../../session-tabs/mobile-database-tab-open'
import { retireMobileSessionTabSelection } from '../../session-tabs/mobile-session-tab-selection'

export abstract class OrcaRuntimeWithMobileDatabaseTabs extends OrcaRuntimeWithRefuseUnattributedMobileSessionTabClose {
  async openMobileSessionDatabaseTab(worktreeId: string, entityId: string, title: string) {
    return openMobileDatabaseTab(
      this,
      this.getAvailableAuthoritativeWindow(),
      worktreeId,
      entityId,
      title
    )
  }

  protected shouldCloseDatabaseTabInMain(): boolean {
    return ORCA_LAYOUT_OWNER_IS_MAIN || !this.notifier?.closeSessionTab
  }

  protected async closeMobileDatabaseTab(
    worktreeId: string,
    tabId: string,
    force?: boolean
  ): Promise<void> {
    const reply = await this.applyLayoutCommand({
      type: 'closeTabs',
      workspace: worktreeId,
      tabIds: [tabId],
      refusePinned: !force,
      recordClose: 'user'
    })
    if (!reply.ok) {
      throw new Error(reply.code)
    }
    if (reply.result.refused?.length) {
      throw new Error('tab_pinned')
    }
    const next = this.mobileSessionTabsByWorktree.get(worktreeId)
    if (next) {
      this.storeMobileSessionSnapshot(
        worktreeId,
        retireMobileSessionTabSelection(
          next,
          next.tabs.filter((row) => row.id !== tabId),
          new Set([tabId])
        )
      )
    }
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId, { force: true })
    this.notifyMobileSessionTabsChanged(worktreeId)
  }
}
