import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { runtimeTargetForWorkspaceOwner } from '@/lib/workspace/ownership/resolve-owner'
import { createDatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import type { DatabaseMentionReference } from '../../../../../../shared/database/database-mention-reference'
export type NativeChatDatabaseMention = {
  reference: DatabaseMentionReference
  engine: string
  environment: string
  executionHostId: string
}
export function useNativeChatDatabaseMentions(
  worktreeId: string | null | undefined,
  query: string | null
) {
  const target = useAppStore(
    useShallow((state) =>
      worktreeId && query !== null
        ? runtimeTargetForWorkspaceOwner(state, { workspaceId: worktreeId })
        : null
    )
  )
  const client = useMemo(() => target && createDatabaseRuntimeClient(target), [target])
  const [state, setState] = useState<{
    worktreeId: string
    entries: NativeChatDatabaseMention[]
    error?: string
    loading: boolean
  }>()
  const enabled = query !== null
  useEffect(() => {
    if (!enabled || !client || !worktreeId) {
      return
    }
    let current = true
    setState({ worktreeId, entries: [], loading: true })
    void Promise.all([client.list({ worktree: worktreeId }), client.status()])
      .then(([connections, status]) => {
        if (current) {
          setState({
            worktreeId,
            entries: connections.map((connection) => ({
              reference: {
                kind: 'database',
                connectionId: connection.id,
                controllerRuntimeId: status.runtimeId,
                aliasAtSelection: connection.alias
              },
              engine: connection.engine,
              environment: connection.environment,
              executionHostId: connection.executionHostId
            })),
            loading: false
          })
        }
      })
      .catch((reason) => {
        if (current) {
          setState({
            worktreeId,
            entries: [],
            loading: false,
            error: reason instanceof Error ? reason.message : String(reason)
          })
        }
      })
    return () => {
      current = false
    }
  }, [client, worktreeId, enabled])
  const available = state?.worktreeId === worktreeId && enabled ? state : undefined
  const needle = query?.toLowerCase() ?? ''
  return {
    databases:
      available?.entries
        .filter((entry) =>
          [entry.reference.aliasAtSelection, entry.engine, entry.environment, entry.executionHostId]
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
        .slice(0, 20) ?? [],
    databasesLoading: enabled && Boolean(client) && (!available || available.loading),
    databasesError: available?.error
  }
}
