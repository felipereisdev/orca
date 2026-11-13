import type { CodexResetCreditRejectedBeforeProviderReason } from '../../../codex-accounts/account-management/codex-account-service-types'
import type { CodexResetCreditExpectedScope } from '../../../../shared/codex-reset-credit-scope'
import type { CodexRateLimitResetOutcome } from '../../../../shared/rate-limit-types'
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
