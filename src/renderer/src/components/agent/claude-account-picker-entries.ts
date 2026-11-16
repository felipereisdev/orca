import { getManagedAccountPrimaryLabel } from '../../../../shared/agent-accounts/managed-account-display-names'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/agent-accounts/managed-account-types'
import type { CodexAccountSelectionTarget } from '../../../../shared/agent-accounts/codex/codex-selection-lane'
import { filterClaudeAccountsForLaunchTarget } from '../../../../shared/agent-accounts/claude/claude-account-launch-target'
import { translate } from '@/i18n/i18n'

export function buildClaudeAccountPickerEntries(
  entry: AgentPickerEntry,
  accounts: ClaudeRateLimitAccountsState,
  target: CodexAccountSelectionTarget
): AgentPickerEntry[] {
  if (entry.agent !== 'claude') {
    return [entry]
  }
  const variants = filterClaudeAccountsForLaunchTarget(accounts.accounts, target).map(
    (account): AgentPickerEntry => ({
      ...entry,
      entryId: `claude:${target.runtime}:${target.wslDistro ?? ''}:${account.id}`,
      claudeAccountId: account.id,
      ...(account.needsSignIn || account.runsOnSystemDefault ? { accountNeedsSignIn: true } : {}),
      label: translate('accounts.claude.launchAccount', 'Claude ({{account}})', {
        account: getManagedAccountPrimaryLabel(account)
      }),
      description: account.displayName ? account.email : (account.organizationName ?? undefined),
      aliases: [account.displayName ?? '', account.email, account.organizationName ?? ''],
      catalog: { origin: 'unknown' }
    })
  )
  return variants.length ? variants : [entry]
}
