import { expect, it } from 'vitest'
import { build, testContext, WS } from '../commands/workspace-layout-command.test-fixture'
import { projectSessionTabs } from './old-client-session-tabs-projection'
import { withMainSessionTabRows } from '../../../main/runtime/session-tabs/main-session-tab-rows'

it('publishes a database tab with its stable reference and retires stale window rows after close', () => {
  const context = testContext()
  const entityId =
    '{"connectionId":"11111111-1111-4111-8111-111111111111","controllerRuntimeId":"controller"}'
  const opened = build(context, [
    { type: 'openDatabaseTab', workspace: WS, tabId: 'database-tab', entityId }
  ]).model
  const groupId = opened.workspaces[WS]!.groups[0]!.id
  const view = {
    groups: { [WS]: { [groupId]: { activeTabId: 'database-tab', recentTabIds: [] } } },
    panes: {},
    editorDrafts: {}
  }
  const facts = { tabLabels: {}, terminalRows: {}, browserTabs: {} }
  const rows = projectSessionTabs(WS, opened.workspaces[WS]!, view, facts, false)
  expect(rows.tabs).toEqual([
    { type: 'database', id: 'database-tab', entityId, title: '@database', isActive: true }
  ])
  expect(rows.activeTabType).toBe('database')
  const closed = build(
    context,
    [{ type: 'closeTabs', workspace: WS, tabIds: ['database-tab'], force: true }],
    opened
  ).model
  const merged = withMainSessionTabRows(
    { ...rows, publicationEpoch: 'window', snapshotVersion: 1 },
    projectSessionTabs(WS, closed.workspaces[WS]!, view, facts, false),
    () => false
  )
  expect(merged.tabs).toEqual([])
  expect(merged.activeTabId).toBeNull()
})
