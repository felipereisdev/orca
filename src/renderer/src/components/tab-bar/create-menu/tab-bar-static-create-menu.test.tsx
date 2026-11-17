// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { getDefaultSettings } from '../../../../../shared/orca-profiles/constants'
import { TabBarStaticCreateMenu } from './tab-bar-static-create-menu'
import { DatabaseConnectionPicker } from '../../database/DatabaseConnectionPicker'
import { createDatabaseClientFixture } from '../../settings/database/testing/database-client-fixture'
import type { DatabaseConnectionSummary } from '../../../../../shared/database/database-contracts'
import type { NewTabMenuLayout } from '../../../../../shared/new-tab-menu/new-tab-menu-layout'
import type { TabBarProps } from '../tab-bar-props'

const rpc = vi.hoisted((): { connections: DatabaseConnectionSummary[] } => ({ connections: [] }))
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
      return rpc.connections
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
const billing = createDatabaseClientFixture().state.configuration
const crm: DatabaseConnectionSummary = {
  ...billing,
  id: '22222222-2222-4222-8222-222222222222',
  alias: 'crm-prd',
  environment: 'PRD'
}

function renderMenu(layout?: NewTabMenuLayout): void {
  // The + menu's create row suspends global shortcuts through the preload bridge.
  Object.assign(window, { api: { ui: { setShortcutRecorderFocused: noop } } })
  useAppStore.setState(
    {
      ...initial,
      settings: { ...getDefaultSettings('/tmp/orca-test'), newTabMenuLayout: layout },
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
        repo: [makeWorktree({ id: WORKSPACE, repoId: 'repo', path: '/fixture' })]
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
    <TooltipProvider>
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
            queueNewActiveTerminalFocusAfterNewTabMenuClose={noop}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <DatabaseConnectionPicker />
    </TooltipProvider>
  )
}

const databaseTabs = () =>
  (useAppStore.getState().unifiedTabsByWorktree[WORKSPACE] ?? []).filter(
    (tab) => tab.contentType === 'database'
  )

function expectExplorerOpenInRightSplit(): void {
  const [tab] = databaseTabs()
  expect(tab).toMatchObject({ contentType: 'database', groupId: 'right' })
  expect(
    useAppStore.getState().groupsByWorktree[WORKSPACE]?.find((entry) => entry.id === 'right')
      ?.activeTabId
  ).toBe(tab.id)
}

it('offers database connections as a create row icon the customizer can hide', () => {
  renderMenu()
  expect(screen.getByRole('button', { name: 'Database connections' })).toBeTruthy()
  cleanup()
  renderMenu({ order: [], hidden: ['database-connections'] })
  expect(screen.queryByRole('button', { name: 'Database connections' })).toBeNull()
})

it('opens the only connection directly in the invoking split', async () => {
  rpc.connections = [billing]
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Database connections' }))
  await waitFor(() => expect(databaseTabs()).toHaveLength(1))
  expectExplorerOpenInRightSplit()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('lets the user pick among several connections', async () => {
  rpc.connections = [billing, crm]
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Database connections' }))
  const dialog = await screen.findByRole('dialog')
  expect(databaseTabs()).toHaveLength(0)
  expect(dialog.textContent).toContain('@faturacao-hmg')
  fireEvent.click(await screen.findByRole('option', { name: /@crm-prd/ }))
  expectExplorerOpenInRightSplit()
  expect(databaseTabs()[0].entityId).toContain(crm.id)
})

it('shows the empty state when the workspace has no connections', async () => {
  rpc.connections = []
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Database connections' }))
  expect((await screen.findByRole('dialog')).textContent).toContain(
    'No connections associated with this project'
  )
  expect(databaseTabs()).toHaveLength(0)
})
