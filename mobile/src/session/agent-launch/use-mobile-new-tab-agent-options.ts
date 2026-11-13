import { CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../src/shared/agent-session/agent-session-create-capabilities'
import { useHostQuery } from '../../query/host-query'
import { expandMobileClaudeAccountOptions } from './mobile-new-tab-agent-options'
import { useEffect, useMemo, useState } from 'react'
import { hashKey, useQueryClient } from '@tanstack/react-query'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { hostConnectionEpoch } from '../../query/host-status-query'
import type { ConnectionState } from '../../transport/connection/connection-state'
import { hostQueryKey } from '../../query/host-query-key'
import {
  detectedAgentsQuery,
  newTabAccountsQuery,
  refreshDetectedAgents,
  reloadNewTabSettings,
  useMobileAgentLaunchQueries,
  type MobileDetectedAgents
} from './mobile-agent-launch-queries'
import { newTabAgentOptionsFrom } from './mobile-new-tab-agent-loader'
import type { MobileNewTabAgentOption } from './mobile-new-tab-agent-options'
import type { MobileNewTabAgentLoadState } from './mobile-agent-load-state'

// A login-shell refresh resets shared desktop state, so it runs once per workspace per connection.
const refreshedTargets = new WeakMap<RpcClient, { epoch: string; targets: Set<string> }>()

function refreshedThisConnection(client: RpcClient): Set<string> {
  const epoch = hostConnectionEpoch(client)
  let entry = refreshedTargets.get(client)
  if (entry?.epoch !== epoch) {
    entry = { epoch, targets: new Set() }
    refreshedTargets.set(client, entry)
  }
  return entry.targets
}

const NO_OPTIONS: MobileNewTabAgentOption[] = []
const NO_INPUT = {}

// Loads with the session (`prefetch`) so the first "+" tap lists agents at once.
export function useMobileNewTabAgentOptions(args: {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  hostCapabilities: readonly string[] | null | undefined
  worktreeId: string
  open: boolean
  prefetch: boolean
}): { loadState: MobileNewTabAgentLoadState; options: MobileNewTabAgentOption[] } {
  const { client, connState, hostId, open } = args
  const queryClient = useQueryClient()
  const connected = client !== null && connState === 'connected'
  const { detection, settings, target, input, settingsSignalled } = useMobileAgentLaunchQueries({
    hostId,
    client,
    worktreeId: args.worktreeId,
    hostCapabilities: args.hostCapabilities,
    enabled: connected && (open || args.prefetch),
    observeLoaded: open
  })
  const accountsSupported =
    args.hostCapabilities?.includes(CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY) === true
  const accounts = useHostQuery(newTabAccountsQuery, { hostId, client }, target, NO_INPUT, {
    enabled: connected && accountsSupported && args.worktreeId !== '' && (open || args.prefetch),
    subscribed:
      open ||
      queryClient.getQueryData(
        hostQueryKey(hostId, newTabAccountsQuery.family, target, NO_INPUT)
      ) === undefined
  })
  useEffect(() => {
    if (open && connected && accountsSupported) {
      void queryClient.invalidateQueries(
        {
          queryKey: hostQueryKey(hostId, newTabAccountsQuery.family, target, NO_INPUT),
          exact: true
        },
        { cancelRefetch: false }
      )
    }
  }, [open, connected, accountsSupported, hostId, queryClient, target])
  // A list this mount did not load may predate an install into a new PATH directory.
  const [mountedAt] = useState(Date.now)

  useEffect(() => {
    if (!open || !client || connState !== 'connected') {
      return
    }
    if (!settingsSignalled) {
      reloadNewTabSettings(queryClient, hostId, target.exec)
    }
    const queryKey = hostQueryKey(hostId, detectedAgentsQuery.family, target, input)
    const cached = queryClient.getQueryState<MobileDetectedAgents>(queryKey)
    const refreshed = refreshedThisConnection(client)
    const targetKey = hashKey(queryKey)
    const reread = () =>
      void queryClient.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false })
    if (cached?.data?.kind !== 'detected') {
      // No list yet, a failed read or another runtime's answer: every open asks again.
      reread()
      return
    }
    if (cached.dataUpdatedAt >= mountedAt) {
      return
    }
    if (cached.data.detectedAgents.length === 0) {
      // As on desktop, an empty list retries through the normal probe rather than a login-shell refresh.
      reread()
      return
    }
    if (refreshed.has(targetKey)) {
      return
    }
    // Claimed now so a reopen does not send a second refresh; the desktop finishes one even if this sheet closes.
    refreshed.add(targetKey)
    let sent = false
    void refreshDetectedAgents(queryClient, { hostId, client }, target, input, () => {
      sent = true
    }).catch(() => {
      // A failed refresh keeps the agents already listed; one that failed before sending may run again.
      if (!sent) {
        refreshed.delete(targetKey)
      }
    })
  }, [client, connState, hostId, input, mountedAt, open, queryClient, settingsSignalled, target])

  const detected = detection.data
  const loadState: MobileNewTabAgentLoadState = !connected
    ? 'idle'
    : detected?.kind === 'other-runtime'
      ? 'other-runtime'
      : detected && settings.data && (!accountsSupported || accounts.data !== undefined)
        ? 'loaded'
        : detection.isError || settings.isError
          ? 'error'
          : 'loading'
  const options = useMemo(
    () =>
      loadState === 'loaded' && detected?.kind === 'detected'
        ? expandMobileClaudeAccountOptions(
            newTabAgentOptionsFrom(settings.data?.settings, detected.detectedAgents),
            accountsSupported ? (accounts.data?.claude.accounts ?? []) : [],
            accounts.data?.claudeLaunchTarget
          )
        : NO_OPTIONS,
    [detected, loadState, settings.data, accounts.data, accountsSupported]
  )
  return { loadState, options }
}
