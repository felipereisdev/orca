import { useState } from 'react'
import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { ClaudeAccountCard, type ClaudeAccountCardModel } from './claude-account-card'
import type { ClaudeRateLimitAccountsState } from '../../../../../../shared/managed-account-types'
import { getDefaultSettings } from '../../../../../../shared/constants'
import type { ProviderAccountAction } from '../accounts-pane-types'
import { createClaudeAccountActionRunner } from '../accounts-pane-account-actions'

const initial: ClaudeRateLimitAccountsState = {
  activeAccountId: 'personal',
  accounts: [
    {
      id: 'work',
      label: 'Empresa',
      email: 'work@example.test',
      organizationName: 'Company Team',
      authMethod: 'subscription-oauth',
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    },
    {
      id: 'personal',
      label: 'Pessoal',
      email: 'personal@example.test',
      organizationName: 'Personal Organization',
      authMethod: 'subscription-oauth',
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    }
  ]
}

function Accounts() {
  const [accounts, setAccounts] = useState(initial)
  const [action, setAction] = useState<ProviderAccountAction>('idle')
  const model: ClaudeAccountCardModel = {
    claudeAccounts: accounts,
    accountRuntime: { runtime: 'host', wslDistro: null, label: 'This device' },
    accountVisibilityOptions: { remoteOwner: false, ownerPlatform: 'darwin' },
    claudeAction: action,
    accountRuntimeUnavailable: false,
    isRemoteAccountScope: false,
    accountOwner: { kind: 'local' },
    setRemoveClaudeTarget: () => {},
    runClaudeAccountAction: createClaudeAccountActionRunner({
      accountOwner: { kind: 'local' },
      accountRuntime: { runtime: 'host', label: 'This device' },
      isRemoteAccountScope: false,
      claudeAccounts: accounts,
      setClaudeAccounts: setAccounts,
      setClaudeAction: setAction,
      fetchSettings: async () => {
        await window.api.settings.get()
      },
      recordFeatureInteraction: () => {},
      isCurrentAccountOwner: () => true
    })
  }
  return (
    <div className="space-y-2 bg-background p-4 text-foreground">
      {accounts.accounts.map((account) => (
        <ClaudeAccountCard key={account.id} account={account} model={model} />
      ))}
    </div>
  )
}

function setup() {
  window.api.settings.get = async () => getDefaultSettings('/home/fixture')
  window.api.claudeAccounts.rename = async ({ accountId, label }) => ({
    ...initial,
    accounts: initial.accounts.map((account) =>
      account.id === accountId ? { ...account, label: label ?? undefined } : account
    )
  })
  window.api.claudeAccounts.select = async ({ accountId }) => ({
    ...initial,
    activeAccountId: accountId
  })
}

const store = { settings: { ...getDefaultSettings('/home/fixture'), uiLanguage: 'en' as const } }

export const idle = defineFixture({ width: 760, setup, store, render: () => <Accounts /> })
export const editing = defineFixture({
  width: 760,
  setup,
  store,
  render: () => <Accounts />,
  interact: (frame) =>
    frame.querySelector<HTMLButtonElement>('[aria-label="Rename account"]')?.click()
})
export const narrow = defineFixture({ width: 390, setup, store, render: () => <Accounts /> })
