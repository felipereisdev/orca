import type { ClaudeManagedAccount } from '../managed-account-types'
import {
  normalizeManagedAccountDisplayName,
  type ManagedAccountDisplayNames
} from '../managed-account-display-names'

type LegacyLabeledClaudeAccount = ClaudeManagedAccount & { label?: unknown }

/** Moves names saved on Claude account records by older builds into the shared account names. */
export function migrateLegacyClaudeAccountLabels(
  settings:
    | {
        claudeManagedAccounts?: readonly LegacyLabeledClaudeAccount[]
        managedAccountDisplayNames?: ManagedAccountDisplayNames
      }
    | undefined
): {
  claudeManagedAccounts?: ClaudeManagedAccount[]
  managedAccountDisplayNames?: ManagedAccountDisplayNames
} {
  const accounts = settings?.claudeManagedAccounts
  if (!Array.isArray(accounts) || !accounts.some((account) => 'label' in account)) {
    return {}
  }
  const claudeNames = { ...settings?.managedAccountDisplayNames?.claude }
  const claudeManagedAccounts = accounts.map(({ label, ...account }) => {
    let name: string | null = null
    try {
      name = typeof label === 'string' ? normalizeManagedAccountDisplayName(label) : null
    } catch {
      name = null
    }
    if (name && claudeNames[account.id] === undefined) {
      claudeNames[account.id] = name
    }
    return account
  })
  return {
    claudeManagedAccounts,
    managedAccountDisplayNames: { ...settings?.managedAccountDisplayNames, claude: claudeNames }
  }
}
