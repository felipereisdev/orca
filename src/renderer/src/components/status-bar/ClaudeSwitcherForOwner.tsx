import { useClaudeSwitcherState } from './use-claude-switcher-state'
import type { ClaudeSwitcherMenuProps } from './ClaudeSwitcherMenu'
import { useProviderAccountList } from './use-provider-account-list'
import { providerChatAccountControl } from './ProviderAccountChatButton'
import React, { useCallback, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import type { AccountOwner } from '@/runtime/provider-accounts/ownership/wsl-host-account-owner'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import {
  selectClaudeProviderAccount,
  emptyClaudeAccountsState
} from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { toast } from 'sonner'
import { getClaudeAccountErrorDescription } from '../../lib/provider-accounts/provider-account-action-errors'
import { useTranslate } from '@/i18n/use-translate'
import { normalizeUsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ClaudeAccountUsagePanel } from './ClaudeAccountUsagePanel'
import { ClaudeAccountSwitchRows } from './ClaudeAccountSwitchRows'
import {
  getWindowsTerminalCapabilityOwnerKey,
  useWindowsTerminalCapabilities
} from '@/runtime/hosts/capabilities/windows-terminal-capabilities'
import {
  getCodexStatusRuntimeKey,
  getStatusBarPreferredWslDistro,
  shouldIncludeSettingsWslRuntime,
  toCodexStatusRuntimeTarget,
  type ClaudeStatusSwitchGroup,
  type CodexStatusRuntimeTarget
} from './status-bar-runtime-targets'
import {
  buildClaudeStatusSwitchGroups,
  signedInClaudeAccountCount,
  getClaudeStatusActiveId,
  normalizeClaudeStatusRuntimeTarget,
  resolveClaudeStatusAccountState
} from './status-bar-claude-accounts'
import { handleRunningClaudeSessionsAfterSwitch } from '@/lib/provider-accounts/claude-account-switch-sessions'
import { AccountRuntimeToggle } from './StatusBarAccountControls'
import { AccountSwitchSection } from './AccountSwitchList'
import { ProviderDetailsMenu } from './ProviderDetailsMenu'
import { signInToClaudeAccount } from '@/lib/provider-accounts/claude-account-sign-in'

export function ClaudeSwitcherForOwner({
  claude,
  compact,
  iconOnly,
  asSubmenu = false,
  triggerContent,
  chatAction,
  usageState,
  usageAccounts,
  owner
}: ClaudeSwitcherMenuProps & { owner: AccountOwner }): React.JSX.Element | null {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [viewRuntime, setViewRuntime] = useState<string | null>(null)
  const display = normalizeUsagePercentageDisplay(useAppStore((s) => s.usagePercentageDisplay))
  const [signingInId, setSigningInId] = useState<string | null>(null)
  const signingInRef = useRef(false)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const refreshClaudeRateLimitsForTarget = useAppStore((s) => s.refreshClaudeRateLimitsForTarget)
  const fetchInactiveClaudeAccountUsage = useAppStore((s) => s.fetchInactiveClaudeAccountUsage)
  const runtimeTarget = chatAction?.target ?? owner.target
  const wslHostDistro = chatAction ? null : owner.wslHostDistro
  const activeRuntimeEnvironmentId = runtimeTargetEnvironmentId(runtimeTarget)
  const hasActiveRuntimeEnvironment = activeRuntimeEnvironmentId !== null
  const {
    inactiveClaudeAccounts,
    claudeTarget: storedClaudeTarget,
    settings,
    ownHostName,
    accountSettings,
    claudeAccountSyncKey
  } = useClaudeSwitcherState(chatAction, activeRuntimeEnvironmentId)
  const claudeTarget = usageState?.claudeTarget ?? storedClaudeTarget
  const providerAccountHostLabel = hasActiveRuntimeEnvironment
    ? (ownHostName ?? t('auto.components.status.bar.StatusBar.remoteServerLabel', 'Remote server'))
    : undefined
  const windowsTerminalCapabilities = useWindowsTerminalCapabilities(
    navigator.userAgent.includes('Windows') || hasActiveRuntimeEnvironment,
    false,
    getWindowsTerminalCapabilityOwnerKey(activeRuntimeEnvironmentId),
    runtimeTarget
  )
  const { accounts, setAccounts, accountsLoaded, loadAccounts, mountedRef } =
    useProviderAccountList(
      'claude',
      runtimeTarget,
      claudeAccountSyncKey,
      emptyClaudeAccountsState(),
      !!chatAction,
      !hasActiveRuntimeEnvironment || !!chatAction
    )
  const accountState =
    hasActiveRuntimeEnvironment && !chatAction
      ? (usageAccounts ?? emptyClaudeAccountsState())
      : resolveClaudeStatusAccountState(accountSettings, accounts, activeRuntimeEnvironmentId)

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      setOpen(nextOpen)
      if (!nextOpen) {
        return
      }
      if (!hasActiveRuntimeEnvironment) {
        void fetchInactiveClaudeAccountUsage()
      }
      if (!hasActiveRuntimeEnvironment || chatAction) {
        void loadAccounts().catch((error) => {
          console.error('Failed to load Claude accounts for status bar:', error)
        })
      }
    },
    [fetchInactiveClaudeAccountUsage, hasActiveRuntimeEnvironment, loadAccounts, chatAction]
  )

  const handleSelectAccount = async (
    accountId: string | null,
    target: CodexStatusRuntimeTarget
  ): Promise<void> => {
    if (isSwitching) {
      return
    }
    const previousActiveAccountId = getClaudeStatusActiveId(accountState, target)
    setIsSwitching(true)
    try {
      if (chatAction && !(await chatAction.canSwitch())) {
        toast.error(
          t(
            'components.native-chat.usageLimitActions.accountUnavailable',
            'This chat cannot move to another account. Hand it off to another agent instead.'
          )
        )
        return
      }
      const next = await selectClaudeProviderAccount(runtimeTarget, {
        accountId,
        runtime: target.runtime,
        wslDistro: target.wslDistro
      })
      recordFeatureInteraction('claude-account-switching')
      if (mountedRef.current) {
        setAccounts(next)
      }
      // Why: remote selections live on the server; local GlobalSettings are untouched, so refetching is pure churn.
      if (!hasActiveRuntimeEnvironment) {
        await fetchSettings()
      }
      const nextActiveAccountId = getClaudeStatusActiveId(next, target)
      if (!chatAction && previousActiveAccountId !== nextActiveAccountId) {
        void handleRunningClaudeSessionsAfterSwitch({
          owner: runtimeTarget,
          target,
          before: { state: accountState, accountId: previousActiveAccountId },
          after: { state: next, accountId: nextActiveAccountId }
        })
      }
    } catch (error) {
      console.error('Failed to switch Claude account from status bar:', error)
      toast.error(
        t('auto.components.settings.AccountsPane.2743cdc0af', 'Claude account update failed.'),
        { description: getClaudeAccountErrorDescription(error) }
      )
    } finally {
      if (mountedRef.current) {
        setIsSwitching(false)
      }
    }
  }

  const handleSignIn = async (accountId: string): Promise<void> => {
    // Why a ref: the row and its button both sign in, and state lags a double press.
    if (signingInRef.current) {
      return
    }
    signingInRef.current = true
    setSigningInId(accountId)
    try {
      if (await signInToClaudeAccount(accountId)) {
        await loadAccounts()
      }
    } finally {
      signingInRef.current = false
      if (mountedRef.current) {
        setSigningInId(null)
      }
    }
  }

  const handleSelectRuntime = async (group: ClaudeStatusSwitchGroup): Promise<void> => {
    if (hasActiveRuntimeEnvironment) {
      setViewRuntime(group.key)
      return
    }
    const currentKey = getCodexStatusRuntimeKey(
      normalizeClaudeStatusRuntimeTarget(accountState, toCodexStatusRuntimeTarget(claudeTarget))
    )
    if (group.key === currentKey) {
      return
    }
    try {
      await refreshClaudeRateLimitsForTarget(group.runtimeTarget)
    } catch (error) {
      console.error('Failed to switch Claude usage runtime:', error)
    }
  }

  const selectedRuntimeKey = getCodexStatusRuntimeKey(
    normalizeClaudeStatusRuntimeTarget(accountState, toCodexStatusRuntimeTarget(claudeTarget))
  )
  // A focused WSL host's accounts are this desktop's for its distro, so that group always shows.
  const fallbackWslDistro =
    wslHostDistro ??
    getStatusBarPreferredWslDistro(settings, windowsTerminalCapabilities.wslDistros)
  const switchGroups = buildClaudeStatusSwitchGroups(
    accountState,
    toCodexStatusRuntimeTarget(claudeTarget),
    {
      fallbackWslDistro,
      includeFallbackWsl:
        wslHostDistro !== null ||
        (!hasActiveRuntimeEnvironment && shouldIncludeSettingsWslRuntime(settings)),
      hostLabel: providerAccountHostLabel,
      systemDefault: chatAction ? 'always' : 'fallback'
    }
  )
  const selectedGroup = chatAction
    ? switchGroups.find((group) => group.runtimeTarget.runtime === 'host')
    : (switchGroups.find((group) => group.key === (viewRuntime ?? selectedRuntimeKey)) ??
      switchGroups[0])

  const accountControl = providerChatAccountControl(
    'claude',
    chatAction,
    accountsLoaded,
    signedInClaudeAccountCount(accounts),
    isSwitching
  )
  if (accountControl?.add) {
    return runtimeTarget.kind === 'local' ? accountControl.button : null
  }

  const openAccountSettings = () => {
    openSettingsTarget({
      pane: 'accounts',
      repoId: null,
      sectionId: 'accounts-claude',
      hostScope: runtimeTarget,
      ...(chatAction ? { intent: 'native-accounts' as const } : {})
    })
    openSettingsPage()
  }

  return (
    <ProviderDetailsMenu
      provider={claude}
      compact={compact}
      iconOnly={iconOnly}
      asSubmenu={asSubmenu}
      triggerContent={triggerContent}
      trigger={accountControl?.button}
      ariaLabel={t(
        'auto.components.status.bar.StatusBar.3dd7ddfae1',
        'Open Claude details and account switcher'
      )}
      variant="account"
      panelContent={
        chatAction ? undefined : (
          <ClaudeAccountUsagePanel
            key={selectedGroup?.key}
            group={selectedGroup}
            accounts={accountState.accounts}
            loaded={
              hasActiveRuntimeEnvironment
                ? usageAccounts != null
                : accountsLoaded || accountState.accounts.length > 0
            }
            activeUsage={selectedGroup?.key === selectedRuntimeKey ? claude : null}
            previews={
              usageState?.inactiveClaudeAccounts ??
              (hasActiveRuntimeEnvironment ? [] : inactiveClaudeAccounts)
            }
            display={display}
            signingInId={signingInId}
            onSignIn={hasActiveRuntimeEnvironment ? undefined : (id) => void handleSignIn(id)}
          />
        )
      }
      accountLabel={
        !hasActiveRuntimeEnvironment
          ? (selectedGroup?.targets.find((target) => target.active)?.label ??
            t('auto.components.status.bar.StatusBar.c676918adc', 'System default'))
          : undefined
      }
      topContent={
        chatAction ? undefined : (
          <AccountRuntimeToggle
            groups={switchGroups}
            value={selectedGroup?.key ?? selectedRuntimeKey}
            onChange={(group) => void handleSelectRuntime(group)}
            ariaLabel={t('auto.components.status.bar.StatusBar.11e2354daf', 'Claude usage runtime')}
          />
        )
      }
      open={open}
      onOpenChange={handleOpenChange}
    >
      {chatAction ? (
        <AccountSwitchSection
          heading={t('auto.components.status.bar.StatusBar.d450654fa2', 'Claude Account')}
          targets={selectedGroup?.targets ?? []}
          panelShowsActiveAccount={!hasActiveRuntimeEnvironment}
          onOpenSettings={openAccountSettings}
        >
          <ClaudeAccountSwitchRows
            group={selectedGroup}
            previews={inactiveClaudeAccounts}
            isSwitching={isSwitching}
            signingInId={signingInId}
            canSignIn={!hasActiveRuntimeEnvironment}
            onSignIn={(id) => void handleSignIn(id)}
            onSelect={(id, target) => void handleSelectAccount(id, target)}
          />
        </AccountSwitchSection>
      ) : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={openAccountSettings}>
            {t('auto.components.status.bar.StatusBar.75ded02687', 'Manage Accounts…')}
          </DropdownMenuItem>
        </>
      )}
    </ProviderDetailsMenu>
  )
}
