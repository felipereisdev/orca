import { expect, it } from 'vitest'
import { surfaceRuntime } from '../terminal/surface/terminal-surface-replies.test-fixture'
import { TEST_WORKTREE_ID } from '../orca-runtime-tests/orca-runtime-test-fixtures.spec'

it('opens, selects, closes and reopens a database tab without a desktop renderer', async () => {
  const { runtime, killed } = surfaceRuntime()
  const entityId =
    '{"connectionId":"11111111-1111-4111-8111-111111111111","controllerRuntimeId":"controller"}'
  const first = await runtime.openMobileSessionDatabaseTab(TEST_WORKTREE_ID, entityId, 'Reporting')
  expect(first.tab.title).toBe('Reporting')
  const second = await runtime.openMobileSessionDatabaseTab(TEST_WORKTREE_ID, entityId, 'Reporting')
  expect(second.tab.id).toBe(first.tab.id)
  const initial = await runtime.listMobileSessionTabs(`id:${TEST_WORKTREE_ID}`)
  expect(initial.tabGroups?.flatMap((group) => group.tabOrder)).toContain(first.tab.id)
  const selected = await runtime.activateMobileSessionTab(
    `id:${TEST_WORKTREE_ID}`,
    first.tab.id,
    undefined,
    { navigation: 'caller', clientNavigationId: 'phone' }
  )
  expect(selected.activeTabType).toBe('database')
  expect(selected.activeTabId).toBe(first.tab.id)
  await runtime.closeMobileSessionTab(`id:${TEST_WORKTREE_ID}`, first.tab.id, { reason: 'user' })
  expect(
    (await runtime.listMobileSessionTabs(`id:${TEST_WORKTREE_ID}`)).tabs.some(
      (tab) => tab.id === first.tab.id
    )
  ).toBe(false)
  const reopened = await runtime.openMobileSessionDatabaseTab(
    TEST_WORKTREE_ID,
    entityId,
    'Reporting'
  )
  const afterReopen = await runtime.listMobileSessionTabs(`id:${TEST_WORKTREE_ID}`)
  expect(afterReopen.tabGroups?.flatMap((group) => group.tabOrder)).toContain(reopened.tab.id)
  expect(afterReopen.tabGroups?.flatMap((group) => group.tabOrder)).not.toContain(first.tab.id)
  expect(reopened.tab.entityId).toBe(entityId)
  expect(reopened.tab.id).not.toBe(first.tab.id)
  expect(killed).toEqual([])
})
