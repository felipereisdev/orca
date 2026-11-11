import { useTranslate } from '@/i18n/use-translate'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useRef } from 'react'
import type {
  DatabaseConnectionSummary,
  DatabaseSchemaResult,
  DatabaseTable
} from '../../../../shared/database/database-contracts'
import type { DatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import { DatabaseParameters } from '../../../../shared/rpc-contract/database-params'
import { buildDatabaseTablePreview } from '../../../../shared/database/database-table-preview'
import type { DatabaseExplorerState } from './database-explorer-state'
export function useDatabaseExplorer(
  client: DatabaseRuntimeClient,
  worktreeId: string,
  controller: DatabaseExplorerState,
  requestedQuery: string | null,
  requestedVersion = 0
) {
  const t = useTranslate()
  const submitting = useRef(false)
  const [starting, setStarting] = useState(false)
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [schema, setSchema] = useState<DatabaseSchemaResult | null>(null)
  const [schemaSource, setSchemaSource] = useState<{
    connectionId: string
    alias: string
    environment: string
    executionHostId: string
    capturedAt: string
  } | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [table, setTable] = useState<DatabaseTable | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const scope = useMemo(() => ({ worktree: worktreeId }), [worktreeId])
  const connection = connections.find((entry) => entry.id === state.connection.connectionId)
  const current = useRef(0)
  const verify = useCallback(async () => {
    if ((await client.status()).runtimeId !== state.connection.controllerRuntimeId) {
      throw new Error(
        t(
          'database.explorer.controllerChanged',
          'The database controller has changed. Select the connection again from this project.'
        )
      )
    }
  }, [client, state.connection.controllerRuntimeId, t])
  useEffect(() => {
    let active = true
    void verify()
      .then(() => client.list(scope))
      .then((value) => {
        if (active) {
          setConnections(value)
        }
      })
      .catch((error) => {
        if (active) {
          setCatalogError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      active = false
    }
  }, [client, scope, verify])
  const describe = useCallback(
    async (schemaName?: string, selected?: DatabaseTable) => {
      const version = ++current.current
      setSchemaLoading(true)
      setSchema(null)
      setSchemaError(null)
      setTable(selected ?? null)
      try {
        await verify()
        const value = await client.describe(
          scope,
          state.connection.connectionId,
          selected?.schema ?? schemaName,
          selected?.name
        )
        if (current.current === version) {
          setSchema(value)
          const selectedConnection = connections.find(
            (entry) => entry.id === state.connection.connectionId
          )
          if (selectedConnection) {
            setSchemaSource({
              connectionId: selectedConnection.id,
              alias: selectedConnection.alias,
              environment: selectedConnection.environment,
              executionHostId: selectedConnection.executionHostId,
              capturedAt: new Date().toISOString()
            })
          }
        }
      } catch (error) {
        if (current.current === version) {
          setSchemaError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (current.current === version) {
          setSchemaLoading(false)
        }
      }
    },
    [client, scope, state.connection.connectionId, verify, connections]
  )

  useEffect(() => {
    setSchema(null)
    setTable(null)
    if (connection) {
      void describe()
    }
    return () => {
      // Invalidate the generation, not a DOM reference, on connection change.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      current.current++
    }
  }, [connection, describe])
  useEffect(() => {
    if (requestedQuery) {
      void controller.openQuery(requestedQuery, async (id) => {
        await verify()
        return client.result(scope, id)
      })
    }
  }, [client, scope, controller, requestedQuery, requestedVersion, verify])
  async function execute() {
    if (submitting.current) {
      return
    }
    submitting.current = true
    setStarting(true)
    controller.error(null)
    try {
      await verify()
      const parameters = DatabaseParameters.parse(JSON.parse(state.parameters))
      const handle = await client.start(scope, state.connection.connectionId, state.sql, parameters)
      setRunningId(handle.queryId)
      await controller.openQuery(
        handle.queryId,
        async (id) => {
          let value = await client.wait(scope, id)
          while (value.status === 'queued' || value.status === 'running') {
            value = await client.wait(scope, id)
          }
          return value
        },
        false
      )
    } catch (error) {
      controller.error(error instanceof Error ? error.message : String(error))
    } finally {
      submitting.current = false
      setStarting(false)
      setRunningId(null)
    }
  }
  return {
    state,
    connections,
    connection,
    catalogError,
    schema: schemaSource?.connectionId === state.connection.connectionId ? schema : null,
    schemaSource,
    schemaError,
    schemaLoading,
    table,
    describe,
    execute,
    starting,
    runningId,
    cancel: async () => {
      if (runningId) {
        try {
          await client.cancel(scope, runningId)
        } catch (error) {
          controller.error(error instanceof Error ? error.message : String(error))
        }
      }
    },
    preview: () => {
      if (connection && table) {
        controller.edit(
          buildDatabaseTablePreview(
            connection.engine,
            table,
            Math.min(100, connection.limits.maxRows)
          )
        )
      }
    }
  }
}
