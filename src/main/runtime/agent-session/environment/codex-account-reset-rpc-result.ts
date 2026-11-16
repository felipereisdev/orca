import type { CodexResetCreditRejectedBeforeProviderReason } from '../../../codex-accounts/account-management/codex-account-service-types'
import type { CodexResetCreditExpectedScope } from '../../../../shared/agent-accounts/codex/codex-reset-credit-scope'
import type { CodexRateLimitResetOutcome } from '../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { AccountsSnapshot } from './runtime-account-controller'

export type CodexRateLimitResetRpcResult = {
  scope: CodexResetCreditExpectedScope
  snapshot: AccountsSnapshot
} & (
  | { outcome: CodexRateLimitResetOutcome }
  | {
      status: 'rejectedBeforeProvider'
      retryDisposition: 'discardAttempt'
      reason: CodexResetCreditRejectedBeforeProviderReason
    }
)
