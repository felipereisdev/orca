// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import type { AppState } from '../../store/types'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { RateLimitState, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { RemoteUsageOwner } from './use-owner-usage-rate-limits'

type FooterStore = Pick<
  AppState,
  | 'settings'
  | 'statusBarItems'
  | 'statusBarClaudeAccountIdsByScope'
  | 'setStatusBarClaudeAccounts'
  | 'fetchInactiveClaudeAccountUsage'
>
let state: FooterStore
vi.mock('../../store', () => ({
  useAppStore: (selector: (snapshot: FooterStore) => unknown) => selector(state)
}))
import { useClaudeFooterAccounts } from './use-claude-footer-accounts'

const accounts = [
  {
    id: 'work',
    label: 'Ucloud',
    email: 'work@example.test',
    managedAuthPath: '',
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  },
  {
    id: 'personal',
    label: 'Pessoal',
    email: 'personal@example.test',
    managedAuthPath: '',
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  },
  {
    id: 'wsl-work',
    label: 'Ubuntu work',
    email: 'work@example.test',
    managedAuthPath: '',
    managedAuthRuntime: 'wsl' as const,
    wslDistro: 'Ubuntu',
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
]
function limits(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    status: 'ok',
    updatedAt: 1,
    error: null
  }
}
function usage(work: number, personal: number): RateLimitState {
  return createEmptyRateLimitState({
    claude: limits(91),
    inactiveClaudeAccounts: [
      { accountId: 'work', rateLimits: limits(work), updatedAt: 1, isFetching: false },
      { accountId: 'personal', rateLimits: limits(personal), updatedAt: 1, isFetching: false },
      { accountId: 'wsl-work', rateLimits: limits(42), updatedAt: 1, isFetching: false }
    ]
  })
}
beforeEach(() => {
  state = {
    settings: { ...getDefaultSettings('/repo'), claudeManagedAccounts: accounts },
    statusBarItems: ['claude'],
    statusBarClaudeAccountIdsByScope: {
      '["local","host"]': ['personal'],
      '["environment:server","host"]': ['work'],
      '["local","wsl:Ubuntu"]': ['wsl-work']
    },
    setStatusBarClaudeAccounts: () => {},
    fetchInactiveClaudeAccountUsage: async () => {}
  }
})
afterEach(cleanup)

it('uses the owning host selection and readings when account IDs match another host', () => {
  const localUsage = usage(3, 18)
  const props: {
    owner: RemoteUsageOwner | null
    accounts: ClaudeRateLimitAccountsState | null
    usage: RateLimitState
  } = { owner: null, accounts: null, usage: localUsage }
  const hook = renderHook(
    (props) => useClaudeFooterAccounts(props.usage, props.accounts, props.owner, false),
    { initialProps: props }
  )
  expect(hook.result.current.selectedIds).toEqual(['personal'])
  expect(hook.result.current.entries([localUsage.claude!])[0].limits.session?.usedPercent).toBe(18)
  const remoteUsage = usage(7, 33)
  hook.rerender({
    owner: { environmentId: 'server', label: 'Server' },
    accounts: {
      accounts: accounts
        .slice(0, 2)
        .map((account) => ({ ...account, label: `Server ${account.label}` })),
      activeAccountId: null
    },
    usage: remoteUsage
  })
  expect(hook.result.current.selectedIds).toEqual(['work'])
  expect(hook.result.current.entries([remoteUsage.claude!])[0].accountLabel).toBe('Server Ucloud')
  expect(hook.result.current.entries([remoteUsage.claude!])[0].limits.session?.usedPercent).toBe(7)
})

it('separates WSL selection and readings from the host runtime', () => {
  const reading = {
    ...usage(3, 18),
    claudeTarget: { runtime: 'wsl' as const, wslDistro: 'Ubuntu' }
  }
  const hook = renderHook(() => useClaudeFooterAccounts(reading, null, null, false))
  expect(hook.result.current.selectedIds).toEqual(['wsl-work'])
  expect(hook.result.current.entries([reading.claude!])[0].accountLabel).toBe('Ubuntu work')
  expect(hook.result.current.entries([reading.claude!])[0].limits.session?.usedPercent).toBe(42)
})

it('does not replace a removed pinned account with system consumption', () => {
  state.statusBarClaudeAccountIdsByScope = { '["local","host"]': ['removed'] }
  const reading = usage(3, 18)
  const hook = renderHook(() => useClaudeFooterAccounts(reading, null, null, false))
  expect(hook.result.current.entries([reading.claude!])).toEqual([])
})
