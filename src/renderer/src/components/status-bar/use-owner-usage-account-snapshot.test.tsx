// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { ProviderAccountsSnapshot } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'

type Handlers = {
  onSnapshot: (snapshot: ProviderAccountsSnapshot) => void
  onError: (error: unknown) => void
}
const source = vi.hoisted(() => {
  const state: { ownerId: string; streams: Handlers[] } = { ownerId: 'server-a', streams: [] }
  return state
})
vi.mock('../../runtime/provider-accounts/ownership/use-active-account-owner', () => ({
  useActiveAccountOwner: () => ({
    target: { kind: 'environment', environmentId: source.ownerId },
    wslHostDistro: null
  })
}))
vi.mock('@/runtime/provider-accounts/observations/runtime-provider-accounts-client', () => ({
  watchProviderAccounts: (_target: unknown, handlers: Handlers) => {
    source.streams.push(handlers)
    return { close: () => {} }
  }
}))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ runtimeEnvironments: [] })
}))
const { useOwnerUsageRateLimits } = await import('./use-owner-usage-rate-limits')

function limits(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1,
    status: 'ok',
    error: null
  }
}
function snapshot(
  activeAccountId: string,
  activePercent: number,
  previewId: string,
  previewPercent: number
): ProviderAccountsSnapshot {
  return {
    claude: {
      activeAccountId,
      accounts: ['personal', 'work'].map((id) => ({
        id,
        email: `${id}@example.test`,
        authMethod: 'subscription-oauth',
        createdAt: 0,
        updatedAt: 0,
        lastAuthenticatedAt: 0
      }))
    },
    codex: { activeAccountId: null, accounts: [] },
    rateLimits: createEmptyRateLimitState({
      claude: limits(activePercent),
      inactiveClaudeAccounts: [
        {
          accountId: previewId,
          rateLimits: limits(previewPercent),
          updatedAt: 1,
          isFetching: false
        }
      ],
      inactiveCodexAccounts: [
        {
          accountId: previewId,
          rateLimits: { ...limits(37), provider: 'codex' },
          updatedAt: 1,
          isFetching: false
        }
      ],
      antigravityAccounts: [
        {
          accountId: previewId,
          email: 'work@example.test',
          active: false,
          rateLimits: { ...limits(62), provider: 'antigravity' }
        }
      ]
    })
  }
}
const local = createEmptyRateLimitState({
  claude: limits(91),
  inactiveClaudeAccounts: [
    { accountId: 'work', rateLimits: limits(88), updatedAt: 1, isFetching: false }
  ]
})
afterEach(() => {
  cleanup()
  source.ownerId = 'server-a'
  source.streams.length = 0
})

it('publishes account selection and usage from the same remote snapshot', () => {
  const { result } = renderHook(() => useOwnerUsageRateLimits(local))
  act(() => source.streams[0].onSnapshot(snapshot('personal', 20, 'work', 5)))
  expect(result.current.claudeAccounts?.activeAccountId).toBe('personal')
  expect(result.current.rateLimits.claude?.session?.usedPercent).toBe(20)
  act(() => source.streams[0].onSnapshot(snapshot('work', 5, 'personal', 20)))
  expect(result.current.claudeAccounts?.activeAccountId).toBe('work')
  expect(result.current.rateLimits.claude?.session?.usedPercent).toBe(5)
  expect(result.current.rateLimits.inactiveClaudeAccounts[0].accountId).toBe('personal')
  expect(result.current.rateLimits.inactiveClaudeAccounts[0].rateLimits?.session?.usedPercent).toBe(
    20
  )
})

it('ends saved-account readings when the owning host becomes unreachable', () => {
  const { result } = renderHook(() => useOwnerUsageRateLimits(local))
  act(() => source.streams[0].onSnapshot(snapshot('personal', 20, 'work', 5)))
  act(() => source.streams[0].onError(new Error('offline')))
  expect(result.current.rateLimits.inactiveClaudeAccounts[0].rateLimits?.session).toBeNull()
  expect(
    result.current.rateLimits.inactiveClaudeAccounts[0].rateLimits?.usageMetadata?.unverifiableOwner
  ).toBe(true)
  expect(result.current.rateLimits.inactiveCodexAccounts[0].rateLimits?.session).toBeNull()
  expect(result.current.rateLimits.antigravityAccounts[0].rateLimits?.session).toBeNull()
})

it('does not reuse an old owner snapshot when the next host has matching account IDs', () => {
  const { result, rerender } = renderHook(() => useOwnerUsageRateLimits(local))
  const first = source.streams[0]
  act(() => first.onSnapshot(snapshot('personal', 20, 'work', 5)))
  source.ownerId = 'server-b'
  rerender()
  expect(result.current.claudeAccounts).toBeNull()
  expect(result.current.rateLimits.inactiveClaudeAccounts).toEqual([])
  act(() => first.onSnapshot(snapshot('work', 99, 'personal', 99)))
  act(() => source.streams[1].onSnapshot(snapshot('work', 6, 'personal', 17)))
  expect(result.current.claudeAccounts?.activeAccountId).toBe('work')
  expect(result.current.rateLimits.claude?.session?.usedPercent).toBe(6)
  expect(result.current.rateLimits.inactiveClaudeAccounts[0].rateLimits?.session?.usedPercent).toBe(
    17
  )
})
