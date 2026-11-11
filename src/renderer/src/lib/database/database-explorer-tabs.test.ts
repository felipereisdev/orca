// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { openDatabaseExplorer } from './database-explorer-tabs'

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: async () => {
    throw new Error('Unknown method: layout.apply')
  }
}))
const initial = useAppStore.getInitialState()
afterEach(() => useAppStore.setState(initial, true))

it.skipIf(ORCA_LAYOUT_OWNER_IS_MAIN)(
  'opens and selects the database explorer in the window-owned layout',
  () => {
    useAppStore.setState(
      {
        ...initial,
        worktreesByRepo: {
          repo: [makeWorktree({ id: 'workspace', repoId: 'repo', path: '/fixture' })]
        },
        activeWorktreeId: 'workspace',
        groupsByWorktree: {
          workspace: [{ id: 'group', worktreeId: 'workspace', activeTabId: null, tabOrder: [] }]
        },
        activeGroupIdByWorktree: { workspace: 'group' }
      },
      true
    )
    const open = () =>
      openDatabaseExplorer({
        worktreeId: 'workspace',
        connection: {
          connectionId: '11111111-1111-4111-8111-111111111111',
          controllerRuntimeId: 'controller'
        }
      })
    open()
    const tab = useAppStore.getState().unifiedTabsByWorktree.workspace?.[0]
    expect(tab).toMatchObject({
      contentType: 'database',
      entityId:
        '{"connectionId":"11111111-1111-4111-8111-111111111111","controllerRuntimeId":"controller"}',
      groupId: 'group'
    })
    expect(useAppStore.getState().groupsByWorktree.workspace?.[0].activeTabId).toBe(tab?.id)
    open()
    expect(
      useAppStore.getState().unifiedTabsByWorktree.workspace?.map((entry) => entry.id)
    ).toEqual([tab?.id])
  }
)
