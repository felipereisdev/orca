import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DatabaseConnectionSummary } from '../../../src/shared/database/database-contracts'
import { DATABASE_RUNTIME_CAPABILITIES } from '../../../src/shared/database/database-runtime-capabilities'
import { SESSION_TABS_DATABASE_RUNTIME_CAPABILITY } from '../../../src/shared/session-tabs-runtime-capabilities'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { translate } from '../i18n/mobile-i18n'
import { createMobileDatabaseClient } from './mobile-database-rpc'

export function useMobileDatabaseConnections(
  client: RpcClient | null,
  worktreeId: string,
  expectedControllerId?: string
) {
  const api = useMemo(
    () => client && createMobileDatabaseClient(client, worktreeId),
    [client, worktreeId]
  )
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    loading: boolean
    connections: DatabaseConnectionSummary[]
    controllerRuntimeId: string | null
    error: string | null
  }>({ loading: true, connections: [], controllerRuntimeId: null, error: null })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let current = true
    setState({ loading: true, connections: [], controllerRuntimeId: null, error: null })
    if (!api) {
      setState({
        loading: false,
        connections: [],
        controllerRuntimeId: null,
        error: translate('database.mobile.offline', 'Connect to the host to use databases.')
      })
      return
    }
    void (async () => {
      const status = await api.status()
      if (
        ![...DATABASE_RUNTIME_CAPABILITIES, SESSION_TABS_DATABASE_RUNTIME_CAPABILITY].every(
          (capability) => status.capabilities?.includes(capability)
        )
      ) {
        throw new Error(
          translate(
            'database.mobile.updateHost',
            'Update Orca on this workspace’s host to use databases.'
          )
        )
      }
      const controllerRuntimeId = await api.controllerIdentity()
      if (expectedControllerId && controllerRuntimeId !== expectedControllerId) {
        throw new Error(
          translate(
            'database.mobile.controllerChanged',
            'The database controller has changed. Open the connection again from New Tab.'
          )
        )
      }
      const connections = await api.list()
      if (current) {
        setState({ loading: false, connections, controllerRuntimeId, error: null })
      }
    })().catch((error: unknown) => {
      if (current) {
        setState({
          loading: false,
          connections: [],
          controllerRuntimeId: null,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
    return () => {
      current = false
    }
  }, [api, expectedControllerId, revision])
  return { api, ...state, refresh }
}
