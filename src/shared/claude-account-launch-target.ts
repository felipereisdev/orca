import type { CodexAccountSelectionTarget } from './codex-selection-lane'

export type ClaudeAccountLaunchTarget =
  | { runtime: 'host'; wslDistro: null }
  | { runtime: 'wsl'; wslDistro: string }

type ScopedClaudeAccount = {
  managedAuthRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
}

export function filterClaudeAccountsForLaunchTarget<Account extends ScopedClaudeAccount>(
  accounts: readonly Account[],
  target: CodexAccountSelectionTarget
): Account[] {
  return accounts.filter(
    (account) =>
      (account.managedAuthRuntime ?? 'host') === target.runtime &&
      (target.runtime !== 'wsl' ||
        account.wslDistro?.toLowerCase() === target.wslDistro?.toLowerCase())
  )
}
