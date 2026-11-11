import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { RateLimitState } from '../../../../shared/rate-limit-types'
import type { UsageProviderSettings } from './status-bar-provider-visibility'

export function buildOwnerUsageProviderSettings({
  settings,
  remoteOwned,
  claudeAccounts,
  rateLimits,
  antigravityUsageConfigured
}: {
  settings: GlobalSettings | null
  remoteOwned: boolean
  claudeAccounts: ClaudeRateLimitAccountsState | null
  rateLimits: RateLimitState
  antigravityUsageConfigured: boolean
}): Partial<UsageProviderSettings> {
  return {
    ...(remoteOwned ? {} : settings),
    claudeManagedAccounts: remoteOwned ? claudeAccounts?.accounts : settings?.claudeManagedAccounts,
    antigravityUsageConfigured,
    minimaxCookieConfigured: rateLimits.minimaxCookieConfigured,
    minimaxApiKeyConfigured: rateLimits.minimaxApiKeyConfigured,
    opencodeGoApiKeyConfigured: rateLimits.opencodeGoApiKeyConfigured,
    grokAuthConfigured: rateLimits.grokAuthConfigured,
    cursorAuthConfigured: rateLimits.cursorAuthConfigured,
    zcodePlanApiKeyConfigured: rateLimits.zcodePlanApiKeyConfigured
  }
}
