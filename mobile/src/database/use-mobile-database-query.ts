import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DatabaseConnectionRef } from '../../../src/shared/database/database-contracts'
import type { DatabaseQueryRecord } from '../../../src/shared/database/database-query-contracts'
import type { MobileDatabaseClient } from './mobile-database-rpc'
import { translate } from '../i18n/mobile-i18n'

import {
  emptyState,
  type QueryState,
  type QueryResult,
  type MobileDatabaseQueryScope
} from './mobile-database-query-state'

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : translate('database.mobile.requestFailed', 'The database request failed')

export function useMobileDatabaseQuery(
  api: MobileDatabaseClient,
  connection: DatabaseConnectionRef
) {
  const { connectionId, controllerRuntimeId } = connection
  const scope = useMemo<MobileDatabaseQueryScope>(
    () => ({
      active: true,
      startLocked: false,
      queryId: null,
      selection: 0,
      historyRequest: 0,
      readAbort: new AbortController()
    }),
    [api, connectionId, controllerRuntimeId]
  )
  const latest = useRef(scope)
  latest.current = scope
  const [stored, setStored] = useState({ scope, value: emptyState })
  const state = stored.scope === scope ? stored.value : emptyState
  const current = useCallback(() => latest.current === scope && scope.active, [scope])
  const update = useCallback(
    (patch: Partial<QueryState>) => {
      if (current()) {
        setStored((previous) => ({
          scope,
          value: { ...(previous.scope === scope ? previous.value : emptyState), ...patch }
        }))
      }
    },
    [scope, current]
  )
  const matches = useCallback(
    (record: DatabaseQueryRecord) =>
      record.source.connectionId === connectionId &&
      record.source.controllerRuntimeId === controllerRuntimeId,
    [connectionId, controllerRuntimeId]
  )
  const verifyController = useCallback(async () => {
    if (!current()) {
      return false
    }
    const identity = await api.controllerIdentity()
    if (!current()) {
      return false
    }
    if (identity !== controllerRuntimeId) {
      throw new Error(
        translate(
          'database.mobile.controllerChanged',
          'The database controller has changed. Open the connection again from New Tab.'
        )
      )
    }
    return true
  }, [api, controllerRuntimeId, current])

  const refreshHistory = useCallback(async () => {
    const request = ++scope.historyRequest
    update({ historyLoading: true, historyError: null })
    try {
      if (!(await verifyController())) {
        return
      }
      const records = await api.history()
      if (current() && request === scope.historyRequest) {
        update({ history: records.filter(matches) })
      }
    } catch (error) {
      if (current() && request === scope.historyRequest) {
        update({ historyError: errorMessage(error) })
      }
    } finally {
      if (current() && request === scope.historyRequest) {
        update({ historyLoading: false })
      }
    }
  }, [api, scope, update, verifyController, current, matches])

  useEffect(() => {
    scope.active = true
    if (scope.readAbort.signal.aborted) {
      scope.readAbort = new AbortController()
    }
    void refreshHistory()
    return () => {
      scope.active = false
      scope.readAbort.abort()
    }
  }, [scope, refreshHistory])

  const selected = useCallback(
    (selection: number) => current() && scope.selection === selection,
    [current, scope]
  )
  const beginRead = useCallback(() => {
    scope.readAbort.abort()
    scope.readAbort = new AbortController()
    return ++scope.selection
  }, [scope])

  const poll = useCallback(
    async (queryId: string, selection: number, initial?: QueryResult) => {
      let snapshot = initial
      while (selected(selection)) {
        if (!snapshot) {
          if (!(await verifyController()) || !selected(selection)) {
            return
          }
          snapshot = await api.wait(queryId, scope.readAbort.signal)
        }
        if (!selected(selection)) {
          return
        }
        if (snapshot.record.queryId !== queryId || !matches(snapshot.record)) {
          throw new Error(
            translate(
              'database.mobile.resultConnectionMismatch',
              'The database result belongs to another connection'
            )
          )
        }
        const running = snapshot.status === 'queued' || snapshot.status === 'running'
        update({ snapshot, loadingResult: false, running })
        if (!running) {
          void refreshHistory()
          return
        }
        snapshot = undefined
      }
    },
    [api, scope, selected, verifyController, matches, update, refreshHistory]
  )

  const execute = useCallback(
    async (sql: string) => {
      if (!current() || scope.startLocked || !sql.trim()) {
        return
      }
      scope.startLocked = true
      const selection = beginRead()
      scope.queryId = null
      update({ snapshot: null, queryId: null, error: null, starting: true, running: false })
      try {
        if (!(await verifyController()) || !selected(selection)) {
          return
        }
        const handle = await api.start(connectionId, sql)
        if (!selected(selection)) {
          return
        }
        if (
          handle.source.connectionId !== connectionId ||
          handle.source.controllerRuntimeId !== controllerRuntimeId
        ) {
          throw new Error(
            translate(
              'database.mobile.queryConnectionMismatch',
              'The database query belongs to another connection'
            )
          )
        }
        scope.queryId = handle.queryId
        update({ queryId: handle.queryId, starting: false, running: true })
        await poll(handle.queryId, selection)
      } catch (error) {
        if (selected(selection)) {
          update({ error: errorMessage(error), running: false })
        }
      } finally {
        scope.startLocked = false
        if (selected(selection)) {
          update({ starting: false })
        }
      }
    },
    [
      api,
      scope,
      current,
      beginRead,
      update,
      verifyController,
      selected,
      connectionId,
      controllerRuntimeId,
      poll
    ]
  )

  const readResult = useCallback(
    async (queryId: string) => {
      const selection = beginRead()
      scope.queryId = queryId
      update({ queryId, snapshot: null, error: null, loadingResult: true, running: false })
      try {
        if (!(await verifyController()) || !selected(selection)) {
          return
        }
        const snapshot = await api.result(queryId, scope.readAbort.signal)
        if (selected(selection)) {
          await poll(queryId, selection, snapshot)
        }
      } catch (error) {
        if (selected(selection)) {
          update({ error: errorMessage(error), running: false })
        }
      } finally {
        if (selected(selection)) {
          update({ loadingResult: false })
        }
      }
    },
    [api, scope, beginRead, update, verifyController, selected, poll]
  )
  const openQuery = useCallback(
    async (record: DatabaseQueryRecord) => {
      if (!current()) {
        return
      }
      if (!matches(record)) {
        update({
          error: translate(
            'database.mobile.queryConnectionMismatch',
            'The database query belongs to another connection'
          )
        })
        return
      }
      await readResult(record.queryId)
    },
    [current, matches, update, readResult]
  )
  const retryResult = useCallback(async () => {
    if (current() && scope.queryId) {
      await readResult(scope.queryId)
    }
  }, [current, scope, readResult])
  const cancel = useCallback(async () => {
    const queryId = scope.queryId
    if (!queryId || !current()) {
      return
    }
    const selection = beginRead()
    update({ cancelling: true, error: null })
    try {
      if (!(await verifyController()) || !selected(selection)) {
        return
      }
      await api.cancel(queryId)
      if (selected(selection)) {
        const snapshot = await api.result(queryId, scope.readAbort.signal)
        if (selected(selection)) {
          await poll(queryId, selection, snapshot)
        }
      }
    } catch (error) {
      if (selected(selection)) {
        update({ error: errorMessage(error), running: false })
      }
    } finally {
      if (selected(selection)) {
        update({ cancelling: false })
      }
    }
  }, [api, scope, current, beginRead, selected, update, verifyController, poll])

  return { ...state, execute, openQuery, cancel, refreshHistory, retryResult }
}
