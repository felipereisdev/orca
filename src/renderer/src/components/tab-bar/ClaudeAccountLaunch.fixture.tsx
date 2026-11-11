import { defineFixture } from '../../component-fixtures/component-fixture'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Button } from '../ui/button'
import { AgentLaunchPickerMenu } from '../agent/AgentLaunchPickerMenu'
import { buildClaudeAccountPickerEntries } from '../agent/claude-account-picker-entries'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'

const base: AgentPickerEntry = {
  agent: 'claude',
  label: 'Claude',
  rows: [
    { agent: 'claude', kind: 'chat', executionHostId: 'local' },
    { agent: 'claude', kind: 'cli', executionHostId: 'local' }
  ],
  surfaces: ['terminal', 'chat'],
  defaultSurface: 'chat',
  terminal: {},
  structured: {},
  catalog: { origin: 'unknown' }
}
const accounts = {
  activeAccountId: 'personal',
  accounts: [
    {
      id: 'personal',
      label: 'Pessoal',
      email: 'personal@example.test',
      authMethod: 'subscription-oauth' as const,
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    },
    {
      id: 'work',
      label: 'Empresa',
      email: 'work@example.test',
      authMethod: 'subscription-oauth' as const,
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    }
  ]
}
function Menu({ roster = accounts }: { roster?: ClaudeRateLimitAccountsState }) {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">+</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <AgentLaunchPickerMenu
          entries={buildClaudeAccountPickerEntries(base, roster, {
            runtime: 'host',
            wslDistro: null
          })}
          runLaunch={() => false}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export const accountsMenu = defineFixture({ width: 390, render: () => <Menu /> })
export const wide = defineFixture({ width: 1280, render: () => <Menu /> })
export const noAccounts = defineFixture({
  width: 390,
  render: () => <Menu roster={{ activeAccountId: null, accounts: [] }} />
})
export const accountsInAnotherRuntime = defineFixture({
  width: 390,
  render: () => (
    <Menu
      roster={{
        ...accounts,
        accounts: accounts.accounts.map((account) => ({
          ...account,
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu'
        }))
      }}
    />
  )
})
