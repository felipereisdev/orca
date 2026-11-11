import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { CodexAccountSelectionTarget } from '../../../../shared/codex-selection-lane'
import { translate } from '@/i18n/i18n'

export function buildClaudeAccountPickerEntries(
  entry: AgentPickerEntry,
  accounts: ClaudeRateLimitAccountsState,
  target: CodexAccountSelectionTarget
): AgentPickerEntry[] {
  if (entry.agent !== 'claude') {
    return [entry]
  }
  const variants = accounts.accounts
    .filter(
      (account) =>
        (account.managedAuthRuntime ?? 'host') === target.runtime &&
        (target.runtime !== 'wsl' ||
          account.wslDistro?.toLowerCase() === target.wslDistro?.toLowerCase())
    )
    .map((account): AgentPickerEntry => ({
      ...entry,
      entryId: `claude:${target.runtime}:${target.wslDistro ?? ''}:${account.id}`,
      claudeAccountId: account.id,
      ...(account.needsSignIn || account.runsOnSystemDefault ? { accountNeedsSignIn: true } : {}),
      label: translate('accounts.claude.launchAccount', 'Claude ({{account}})', {
        account: account.label || account.email
      }),
      description: account.label ? account.email : (account.organizationName ?? undefined),
      aliases: [account.label ?? '', account.email, account.organizationName ?? ''],
      catalog: { origin: 'unknown' }
    }))
  return variants.length ? variants : [entry]
}
