import { expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import { buildOwnerUsageProviderSettings } from './owner-usage-provider-settings'
import { getVisibleUsageProvider } from './status-bar-provider-visibility'
import { buildClaudeStatusSwitchGroups } from './status-bar-claude-accounts'
import { buildStatusBarUsageEntries } from './status-bar-usage-entries'

const account = {
  id: 'work',
  label: 'Work',
  email: 'work@example.test',
  authMethod: 'subscription-oauth' as const,
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
}
const reading = createEmptyRateLimitState({
  claude: {
    provider: 'claude',
    session: null,
    weekly: null,
    status: 'unavailable',
    updatedAt: 0,
    error: null,
    usageMetadata: { failureKind: 'missing-credentials' }
  },
  inactiveClaudeAccounts: [
    {
      accountId: 'work',
      rateLimits: {
        provider: 'claude',
        session: { usedPercent: 3, windowMinutes: 300, resetsAt: null, resetDescription: null },
        weekly: null,
        status: 'ok',
        updatedAt: 1,
        error: null
      },
      updatedAt: 1,
      isFetching: false
    }
  ]
})

it('shows remote saved-account consumption when the remote system login is unavailable', () => {
  const accounts = { accounts: [account], activeAccountId: null }
  const settings = buildOwnerUsageProviderSettings({
    settings: getDefaultSettings('/repo'),
    remoteOwned: true,
    claudeAccounts: accounts,
    rateLimits: reading,
    antigravityUsageConfigured: false
  })
  const provider = getVisibleUsageProvider('claude', reading.claude, settings)
  expect(provider).not.toBeNull()
  const group = buildClaudeStatusSwitchGroups(accounts, reading.claudeTarget, {
    systemDefault: 'fallback'
  })[0]
  const entries = buildStatusBarUsageEntries(
    provider ? [provider] : [],
    group,
    ['work'],
    'server',
    reading
  )
  expect(entries[0]?.accountLabel).toBe('Work')
  expect(entries[0]?.limits.session?.usedPercent).toBe(3)
})

it('does not treat desktop accounts as configured on an empty remote host', () => {
  const settings = buildOwnerUsageProviderSettings({
    settings: {
      ...getDefaultSettings('/repo'),
      claudeManagedAccounts: [{ ...account, managedAuthPath: '' }]
    },
    remoteOwned: true,
    claudeAccounts: { accounts: [], activeAccountId: null },
    rateLimits: reading,
    antigravityUsageConfigured: false
  })
  expect(getVisibleUsageProvider('claude', reading.claude, settings)).toBeNull()
})
