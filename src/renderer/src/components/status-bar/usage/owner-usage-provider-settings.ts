import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../../../shared/agent-accounts/managed-account-types'
import type { RateLimitState } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { UsageProviderSettings } from '../composition/status-bar-provider-visibility'

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

/** The usage providers the status bar can show, without the account and setup fields beside them. */
export function pickUsageProviderSnapshots(rateLimits: RateLimitState) {
  const { claude, codex, gemini, opencodeGo, kimi, antigravity, minimax, grok, cursor, zcode } =
    rateLimits
  return {
    claude,
    codex,
    gemini,
    opencodeGo,
    kimi,
    antigravity,
    minimax,
    grok,
    cursor,
    zcode,
    muse: rateLimits.muse
  }
}
