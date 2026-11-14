import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { listTaskBoard } from '@/runtime/task-board/runtime-task-board-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import {
  markTaskBoardLoaded,
  readTaskBoardCards,
  readTaskBoardLoaded,
  writeTaskBoardCards
} from './task-board-session-cache'
import {
  applyTaskBoardList,
  failTaskBoardList,
  startTaskBoardReload,
  type TaskBoardViewState
} from './task-board-view-state'

/** A board listed this recently is shown from the session cache when it mounts again. */
const MOUNT_REUSE_MS = 45_000

/** Settings that change what the host lists; editing them in Settings → Tasks re-lists. */
function useTaskBoardScopeKey(): string {
  const visibleTaskProviders = useAppStore((s) => s.settings?.visibleTaskProviders)
  const taskBoard = useAppStore((s) => s.settings?.taskBoard)
  return JSON.stringify([visibleTaskProviders ?? null, taskBoard ?? null])
}

function listErrorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : translate('taskBoard.loadFailed', 'Could not load issues. Refresh to try again.')
}

/** The board of `accountHostId` (the Tasks page's `accountBackedTaskSourceHostId`), read from its host. */
export function useTaskBoardCards(accountHostId: ExecutionHostId): {
  state: TaskBoardViewState
  refresh: () => void
  /** A fresh list; resolves once its result reached the board (or was superseded). */
  reread: () => Promise<void>
} {
  // The last board for this host shows at once; the mount load then updates it.
  const [stateHostId, setStateHostId] = useState(accountHostId)
  const [state, setState] = useState(() => readTaskBoardCards(accountHostId))
  if (stateHostId !== accountHostId) {
    setStateHostId(accountHostId)
    setState(readTaskBoardCards(accountHostId))
  }
  useEffect(() => writeTaskBoardCards(stateHostId, state), [stateHostId, state])
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const scopeKey = useTaskBoardScopeKey()
  const scopeKeyRef = useRef(scopeKey)
  const loadedScopeKeyRef = useRef<string | null>(null)
  useEffect(() => {
    scopeKeyRef.current = scopeKey
  }, [scopeKey])

  const load = useCallback(
    async (fresh: boolean): Promise<void> => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const loadScopeKey = scopeKeyRef.current
      const update = (next: (current: TaskBoardViewState) => TaskBoardViewState): void => {
        if (mountedRef.current) {
          setState(next)
          return
        }
        // Why: a move settling after the board unmounted still re-lists; the next mount trusts this cache.
        writeTaskBoardCards(accountHostId, next(readTaskBoardCards(accountHostId)))
      }
      update(startTaskBoardReload)
      try {
        const target = ipcOrRuntimeTargetForHostId(accountHostId)
        if (!target) {
          update((current) =>
            failTaskBoardList(
              current,
              translate('taskBoard.hostUnavailable', 'This host is not available.')
            )
          )
          return
        }
        const result = await listTaskBoard(target, { fresh, signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        markTaskBoardLoaded(accountHostId, { at: Date.now(), scopeKey: loadScopeKey })
        update(() => applyTaskBoardList(result))
      } catch (cause) {
        if (!controller.signal.aborted) {
          update((current) => failTaskBoardList(current, listErrorMessage(cause)))
        }
      }
    },
    [accountHostId]
  )

  // Refresh and post-move reads are explicit, so they bypass the host's and providers' caches.
  const reread = useCallback(() => load(true), [load])
  const refresh = useCallback(() => void load(true), [load])

  useEffect(() => {
    mountedRef.current = true
    // Why: opening a card's detail and coming back must not re-list the whole board every time.
    const loaded = readTaskBoardLoaded(accountHostId)
    const cached = readTaskBoardCards(accountHostId)
    const reusable =
      loaded !== undefined &&
      Date.now() - loaded.at < MOUNT_REUSE_MS &&
      loaded.scopeKey === scopeKeyRef.current &&
      Object.values(cached.providers).every(
        (provider) => provider.status !== 'loading' && provider.refreshing !== true
      )
    if (!reusable) {
      void load(false)
    }
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      mountedRef.current = false
    }
  }, [accountHostId, load])

  // The mount load covers the first key; afterwards a settings change re-lists.
  useEffect(() => {
    const previous = loadedScopeKeyRef.current
    loadedScopeKeyRef.current = scopeKey
    if (previous !== null && previous !== scopeKey) {
      void load(false)
    }
  }, [scopeKey, load])

  return { state, refresh, reread }
}
