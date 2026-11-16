import { describe, expect, it } from 'vitest'
import type { ClaudeAccountSummary } from '../../accounts/accounts-snapshot'
import { filterClaudeAccountsForLaunchTarget } from '../../../../src/shared/agent-accounts/claude/claude-account-launch-target'
import {
  expandMobileClaudeAccountOptions,
  type MobileNewTabAgentOption
} from './mobile-new-tab-agent-options'

const accounts: ClaudeAccountSummary[] = [
  { id: 'claude-host', email: 'host@example.com', displayName: 'Host account' },
  { id: 'claude-ubuntu-a', email: 'a@example.com', managedAuthRuntime: 'wsl', wslDistro: 'Ubuntu' },
  { id: 'claude-ubuntu-b', email: 'b@example.com', managedAuthRuntime: 'wsl', wslDistro: 'ubuntu' },
  {
    id: 'claude-debian',
    email: 'debian@example.com',
    managedAuthRuntime: 'wsl',
    wslDistro: 'Debian'
  }
]

const options: MobileNewTabAgentOption[] = [
  { agent: 'claude', label: 'Claude' },
  { agent: 'codex', label: 'Codex' }
]

describe('named Claude accounts on a new tab', () => {
  it('keeps only accounts owned by the launch runtime, matching WSL distros case-insensitively', () => {
    expect(
      filterClaudeAccountsForLaunchTarget(accounts, { runtime: 'wsl', wslDistro: 'UBUNTU' }).map(
        (account) => account.id
      )
    ).toEqual(['claude-ubuntu-a', 'claude-ubuntu-b'])
    expect(
      filterClaudeAccountsForLaunchTarget(accounts, { runtime: 'host', wslDistro: null }).map(
        (account) => account.id
      )
    ).toEqual(['claude-host'])
  })

  it('replaces the Claude option with one per account of the target runtime', () => {
    expect(
      expandMobileClaudeAccountOptions(options, accounts, { runtime: 'wsl', wslDistro: 'Ubuntu' })
    ).toEqual([
      { agent: 'claude', label: 'a@example.com', claudeAccountId: 'claude-ubuntu-a' },
      { agent: 'claude', label: 'b@example.com', claudeAccountId: 'claude-ubuntu-b' },
      { agent: 'codex', label: 'Codex' }
    ])
    expect(
      expandMobileClaudeAccountOptions(options, accounts, { runtime: 'host', wslDistro: null })
    ).toEqual([
      { agent: 'claude', label: 'Host account', claudeAccountId: 'claude-host' },
      { agent: 'codex', label: 'Codex' }
    ])
  })

  it('keeps the plain Claude option without a target or without accounts there', () => {
    expect(expandMobileClaudeAccountOptions(options, accounts, null)).toEqual(options)
    expect(
      expandMobileClaudeAccountOptions(options, accounts, { runtime: 'wsl', wslDistro: 'Arch' })
    ).toEqual(options)
  })
})
