import { expect, it } from 'vitest'
import { asLoaded, build, testContext, WS } from './workspace-layout-command.test-fixture'
import { saveWorkspaceLayout } from './workspace-layout-save'
import { loadWorkspaceLayout } from './workspace-layout-load'
import { parseWorkspaceSession } from '../workspace-session/workspace-session-schema'
it('restores a database reference in its split and closes it without creating an editor file', () => {
  const context = testContext()
  const first = build(context, [{ type: 'createTerminalTab', workspace: WS }]).model
  const group = first.workspaces[WS]!.groups[0]!.id
  const entityId =
    '{"connectionId":"11111111-1111-4111-8111-111111111111","controllerRuntimeId":"controller"}'
  const opened = build(
    context,
    [
      {
        type: 'openDatabaseTab',
        workspace: WS,
        tabId: 'db-1',
        entityId,
        groupId: 'db-group',
        split: { besideGroupId: group, direction: 'right' }
      }
    ],
    first
  ).model
  const parsed = parseWorkspaceSession(saveWorkspaceLayout(asLoaded(opened)))
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  const saved = parsed.value
  const restored = loadWorkspaceLayout('local', saved, {
    mintId: (seed) => seed,
    mintLeafId: () => '00000000-0000-4000-9000-000000000001'
  }).layout
  expect(restored.workspaces[WS]?.tabs.find((tab) => tab.id === 'db-1')).toMatchObject({
    kind: 'database',
    entityId
  })
  expect(
    restored.workspaces[WS]?.groups.find((entry) => entry.id === 'db-group')?.tabOrder
  ).toEqual(['db-1'])
  expect(restored.workspaces[WS]?.editorFiles ?? []).toEqual([])
  const closed = build(
    context,
    [{ type: 'closeTabs', workspace: WS, tabIds: ['db-1'], force: true }],
    restored
  ).model
  expect(closed.workspaces[WS]?.groups.map((entry) => entry.id)).toEqual([group])
})
