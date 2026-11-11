// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { TabBarStaticCreateMenu } from './tab-bar-static-create-menu'
import { createDatabaseClientFixture } from '../settings/database/testing/database-client-fixture'
import type { TabBarProps } from './tab-bar-props'

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: async (_target: unknown, method: string) => {
    if (method === 'status.get') {
      return {
        runtimeId: 'fixture-controller',
        capabilities: ['database.catalogV1', 'database.executionV1', 'database.writeV1']
      }
    }
    if (method === 'database.executionCapabilities') {
      return { controllerRuntimeId: 'fixture-controller' }
    }
    if (method === 'database.list') {
      return [createDatabaseClientFixture().state.configuration]
    }
    throw new Error('Unexpected fixture request')
  }
}))
const WORKSPACE = 'repo::/fixture'
const initial = useAppStore.getInitialState()
afterEach(() => {
  cleanup()
  useAppStore.setState(initial, true)
})
const noop = () => {}

it('opens a project database from the plus menu in the invoking split', async () => {
  useAppStore.setState(
    {
      ...initial,
      repos: [
        {
          id: 'repo',
          path: '/fixture',
          displayName: 'Fixture',
          badgeColor: '',
          addedAt: 0,
          executionHostId: 'local'
        }
      ],
      worktreesByRepo: {
        repo: [
          makeWorktree({
            id: WORKSPACE,
            repoId: 'repo',
            path: '/fixture'
          })
        ]
      },
      activeWorktreeId: WORKSPACE,
      activeWorkspaceExecutionHostId: 'local',
      groupsByWorktree: {
        [WORKSPACE]: ['left', 'right'].map((id) => ({
          id,
          worktreeId: WORKSPACE,
          activeTabId: null,
          tabOrder: []
        }))
      },
      activeGroupIdByWorktree: { [WORKSPACE]: 'left' }
    },
    true
  )
  const props: TabBarProps = {
    tabs: [],
    activeTabId: null,
    groupId: 'right',
    worktreeId: WORKSPACE,
    expandedPaneByTabId: {},
    onActivate: noop,
    onClose: noop,
    onCloseOthers: noop,
    onCloseToRight: noop,
    onCloseToLeft: noop,
    onNewTerminalTab: noop,
    onNewBrowserTab: noop,
    onSetCustomTitle: noop,
    onSetTabColor: noop,
    onTogglePaneExpand: noop
  }
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>+</DropdownMenuTrigger>
      <DropdownMenuContent>
        <TabBarStaticCreateMenu
          props={props}
          groupId="right"
          terminalOnly={false}
          mobileEmulatorEnabled={false}
          managedBrowserCreationEnabled={false}
          mobileEmulatorCreationEnabled={false}
          workspaceHasSimulatorTab={false}
          showMobileEmulatorIntroCallout={false}
          windowsShellEntries={undefined}
          defaultWindowsPowerShellImplementation="auto"
          pwshAvailable={false}
          newTerminalShortcut=""
          newBrowserShortcut=""
          newSimulatorShortcut=""
          newFileShortcut=""
          openMarkdownShortcut={null}
          queueNewActiveTerminalFocusAfterNewTabMenuClose={noop}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Database connections' }), {
    key: 'ArrowRight'
  })
  fireEvent.click(await screen.findByRole('menuitem', { name: /@faturacao-hmg/ }))
  expect(useAppStore.getState().unifiedTabsByWorktree[WORKSPACE]?.[0]).toMatchObject({
    contentType: 'database',
    groupId: 'right'
  })
  expect(
    useAppStore.getState().groupsByWorktree[WORKSPACE]?.find((entry) => entry.id === 'right')
      ?.activeTabId
  ).toBe(useAppStore.getState().unifiedTabsByWorktree[WORKSPACE]?.[0].id)
})
