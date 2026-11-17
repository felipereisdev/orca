import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { runtimeTargetForWorkspaceOwner } from '@/lib/workspace/ownership/resolve-owner'
import {
  createDatabaseRuntimeClient,
  type DatabaseRuntimeClient
} from '@/runtime/database/database-runtime-client'
import type { DatabaseConnectionSummary } from '../../../../shared/database/database-contracts'

export type WorkspaceDatabaseConnections =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: DatabaseConnectionSummary[]; controllerRuntimeId: string }

const LOADING: WorkspaceDatabaseConnections = { status: 'loading' }

/** The database runtime that owns a workspace, or null when no runtime can serve it. */
export function useWorkspaceDatabaseClient(
  worktreeId: string | null
): DatabaseRuntimeClient | null {
  const target = useAppStore(
    useShallow((state) =>
      worktreeId ? runtimeTargetForWorkspaceOwner(state, { workspaceId: worktreeId }) : null
    )
  )
  return useMemo(() => (target ? createDatabaseRuntimeClient(target) : null), [target])
}

/** Loads a workspace's connections once per `loadKey`; a null key loads nothing. */
export function useWorkspaceDatabaseConnections(
  client: DatabaseRuntimeClient | null,
  worktreeId: string | null,
  loadKey: number | null
): WorkspaceDatabaseConnections {
  const [loaded, setLoaded] = useState<{
    key: number
    result: WorkspaceDatabaseConnections
  } | null>(null)
  useEffect(() => {
    if (loadKey === null || !client || !worktreeId) {
      return
    }
    let active = true
    const settle = (result: WorkspaceDatabaseConnections): void => {
      if (active) {
        setLoaded({ key: loadKey, result })
      }
    }
    void Promise.all([client.list({ worktree: worktreeId }), client.controllerIdentity()])
      .then(([entries, controllerRuntimeId]) =>
        settle({ status: 'ready', entries, controllerRuntimeId })
      )
      .catch((reason: unknown) =>
        settle({
          status: 'error',
          message: reason instanceof Error ? reason.message : String(reason)
        })
      )
    return () => {
      active = false
    }
  }, [client, worktreeId, loadKey])
  return loaded && loaded.key === loadKey ? loaded.result : LOADING
}
