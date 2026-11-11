import { useCallback, useEffect, useMemo } from 'react'
import {
  useAppStateValue,
  useAppStateViewActive,
  useAppViewExternalStore
} from '@/store/retained-views/app-state-view'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/native-chat/status/structured-agent-session-status-feed'
import { useProviderAccountList } from '../status-bar/use-provider-account-list'
import { getClaudeAccountLabel } from '@/lib/provider-accounts/claude-account-label'

export function ClaudeChatAccountLabel({
  tabId,
  worktreeId,
  sessionId
}: {
  tabId: string
  worktreeId: string
  sessionId: string
}) {
  const active = useAppStateViewActive()
  const owner = useAppStateValue((state) => {
    const tab = state.unifiedTabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tabId)
    return tab ? structuredAgentSessionOwnerForTab(state, tab) : null
  })
  const target = useMemo(() => structuredAgentSessionTargetForHost(owner), [owner])
  const feed = useMemo(
    () => (target ? getStructuredAgentSessionStatusFeed(target) : null),
    [target]
  )
  useEffect(() => (active ? feed?.activate() : undefined), [active, feed])
  const subscribe = useCallback(
    (listener: () => void) => feed?.subscribeSession(sessionId, listener) ?? (() => {}),
    [feed, sessionId]
  )
  const accountId = useAppViewExternalStore(
    subscribe,
    () => feed?.getSnapshot().get(sessionId)?.claudeAccountId ?? null,
    () => null
  )
  const initial = useMemo(() => ({ accounts: [], activeAccountId: null }), [])
  const { accounts } = useProviderAccountList(
    'claude',
    target ?? { kind: 'local' },
    accountId ?? '',
    initial,
    active
  )
  if (!accountId) {
    return null
  }
  return (
    <span className="min-w-0 truncate px-2 text-xs text-chat-foreground-faint">
      {getClaudeAccountLabel(accounts, accountId)}
    </span>
  )
}
