import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import type { ClaudeStatusSwitchGroup } from './status-bar-runtime-targets'
import { createPendingProviderSnapshot } from './status-bar-provider-visibility'

export type StatusBarUsageEntry = { id: string; limits: ProviderRateLimits; accountLabel?: string }

export function buildStatusBarUsageEntries(
  providers: readonly ProviderRateLimits[],
  group: ClaudeStatusSwitchGroup | undefined,
  selectedIds: readonly string[],
  scope: string,
  usage: RateLimitState
): StatusBarUsageEntry[] {
  const accounts = group?.targets.filter((target) => target.id !== null) ?? []
  return providers.flatMap<StatusBarUsageEntry>((provider) => {
    if (provider.provider !== 'claude' || accounts.length === 0) {
      return [{ id: provider.provider, limits: provider }]
    }
    return accounts
      .filter((target) => target.id && selectedIds.includes(target.id))
      .map((target) => {
        const preview = usage.inactiveClaudeAccounts.find(
          (account) => account.accountId === target.id
        )
        const missing = {
          ...createPendingProviderSnapshot('claude'),
          status: preview?.isFetching ? ('fetching' as const) : ('unavailable' as const)
        }
        const limits = provider.usageMetadata?.unverifiableOwner
          ? provider
          : target.needsSignIn
            ? { ...missing, status: 'error' as const, error: target.hint ?? null }
            : target.active
              ? provider
              : (preview?.rateLimits ?? missing)
        return { id: JSON.stringify([scope, target.id]), accountLabel: target.label, limits }
      })
  })
}
