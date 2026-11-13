import { randomUUID as databaseTabUuid } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { requestDatabaseTabOpenFromRenderer } from '../../window/renderer-relays/database-tab-open-relay'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../shared/layout-owner-switch'
import type { OrcaRuntimeService } from '../orca-runtime'

type Host = Pick<
  OrcaRuntimeService,
  | 'listMobileSessionTabs'
  | 'applyLayoutCommand'
  | 'hydrateHeadlessMobileSessionTabsFromWorkspaceSession'
>
export async function openMobileDatabaseTab(
  host: Host,
  win: BrowserWindow | null,
  worktreeId: string,
  entityId: string,
  title: string
) {
  const current = await host.listMobileSessionTabs(`id:${worktreeId}`)
  const existing = current.tabs.find((tab) => tab.type === 'database' && tab.entityId === entityId)
  let tabId = existing?.id
  if (!tabId) {
    tabId = databaseTabUuid()
    if (!ORCA_LAYOUT_OWNER_IS_MAIN && win) {
      tabId = await requestDatabaseTabOpenFromRenderer(win, {
        worktreeId,
        entityId,
        tabId,
        title
      })
    } else {
      const reply = await host.applyLayoutCommand({
        type: 'openDatabaseTab',
        workspace: worktreeId,
        tabId,
        entityId
      })
      if (!reply.ok) {
        throw new Error(reply.code)
      }
      tabId = reply.result.tabId ?? tabId
      const renamed = await host.applyLayoutCommand({
        type: 'renameTab',
        workspace: worktreeId,
        tabId,
        kind: 'custom',
        title
      })
      if (!renamed.ok) {
        throw new Error(renamed.code)
      }
      host.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId, { force: true })
    }
  }
  const snapshot = await host.listMobileSessionTabs(`id:${worktreeId}`)
  const tab = snapshot.tabs.find((row) => row.type === 'database' && row.id === tabId)
  if (!tab || tab.type !== 'database') {
    throw new Error('database_tab_not_published')
  }
  return { tab }
}
