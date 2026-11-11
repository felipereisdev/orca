import { useEffect, useMemo } from 'react'
import { useAppStore } from '../../store'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { RateLimitState, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { buildStatusBarUsageEntries } from './status-bar-usage-entries'
import type { RemoteUsageOwner } from './use-owner-usage-rate-limits'
import { useProviderAccountList } from './use-provider-account-list'
import {
  getClaudeAccountRosterSyncKey,
  getClaudeAccountSettings
} from './provider-account-sync-key'
import {
  emptyClaudeAccountsState,
  getProviderAccountsOwnerKey
} from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import {
  buildClaudeStatusSwitchGroups,
  normalizeClaudeStatusRuntimeTarget,
  resolveClaudeStatusAccountState
} from './status-bar-claude-accounts'
import { getCodexStatusRuntimeKey, toCodexStatusRuntimeTarget } from './status-bar-runtime-targets'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

export function useClaudeFooterAccounts(
  usage: RateLimitState,
  remoteAccounts: ClaudeRateLimitAccountsState | null,
  owner: RemoteUsageOwner | null,
  visible: boolean
) {
  const settings = useAppStore((s) => getClaudeAccountSettings(s.settings))
  const syncKey = useAppStore((s) => getClaudeAccountRosterSyncKey(s.settings))
  const preferences = useAppStore((s) => s.statusBarClaudeAccountIdsByScope)
  const setSelected = useAppStore((s) => s.setStatusBarClaudeAccounts)
  const enabled = useAppStore((s) => s.statusBarItems.includes('claude'))
  const refresh = useAppStore((s) => s.fetchInactiveClaudeAccountUsage)
  const environmentId = owner?.environmentId
  const target = useMemo(
    () =>
      environmentId ? { kind: 'environment' as const, environmentId } : { kind: 'local' as const },
    [environmentId]
  )
  const initial = useMemo(() => emptyClaudeAccountsState(), [])
  const local = useProviderAccountList('claude', target, syncKey, initial, false, !owner && visible)
  const accounts = owner
    ? (remoteAccounts ?? initial)
    : resolveClaudeStatusAccountState(settings, local.accounts, null)
  const runtime = normalizeClaudeStatusRuntimeTarget(
    accounts,
    toCodexStatusRuntimeTarget(usage.claudeTarget)
  )
  const runtimeKey = getCodexStatusRuntimeKey(runtime)
  const group = buildClaudeStatusSwitchGroups(accounts, runtime, {
    systemDefault: 'fallback',
    hostLabel: owner?.label
  }).find((group) => group.key === runtimeKey)
  const scopeKey = JSON.stringify([getProviderAccountsOwnerKey(target), runtimeKey])
  const targets = group?.targets.filter((target) => target.id !== null) ?? []
  const defaultId = targets.find((target) => target.active)?.id ?? targets[0]?.id
  const selectedIds = (preferences[scopeKey] ?? (defaultId ? [defaultId] : [])).filter((id) =>
    targets.some((target) => target.id === id)
  )
  const needsPreview =
    visible &&
    enabled &&
    !owner &&
    targets.some((target) => !target.active && selectedIds.includes(target.id!))
  const refreshKey = JSON.stringify(selectedIds)
  useEffect(() => {
    if (!needsPreview) {
      return
    }
    return installWindowVisibilityInterval({
      run: () => void refresh(),
      intervalMs: 5 * 60_000,
      slowWhileUnfocused: true
    })
  }, [needsPreview, refreshKey, refresh])
  return {
    group,
    scopeKey,
    selectedIds,
    enabled,
    ...(needsPreview ? { refreshPreviews: refresh } : {}),
    entries: (providers: readonly ProviderRateLimits[]) =>
      buildStatusBarUsageEntries(providers, group, selectedIds, scopeKey, usage),
    setSelected: (ids: string[]) => setSelected(scopeKey, ids)
  }
}
