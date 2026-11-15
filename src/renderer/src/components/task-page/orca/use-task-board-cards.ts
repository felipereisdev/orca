import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { listTaskBoard } from '@/runtime/task-board/runtime-task-board-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import { subscribeTaskBoardRunsChanged } from '@/runtime/task-board/task-board-runs-changed'
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
/** A run's phase reports come in bursts; one list answers them all. */
const RUNS_REREAD_DELAY_MS = 300

/** Settings that change what the host lists; editing them in Settings → Task Sources re-lists. */
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
  /** The host's cached list without the reload indicator, for task-start run changes; coalesced, after any list in flight. */
  rereadRuns: () => void
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
    async (fresh: boolean, options: { quiet?: boolean } = {}): Promise<void> => {
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
      if (!options.quiet) {
        update(startTaskBoardReload)
      }
      try {
        const target = ipcOrRuntimeTargetForHostId(accountHostId)
        if (!target) {
          if (options.quiet) {
            return
          }
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
        if (controller.signal.aborted) {
          return
        }
        // A background run re-read keeps the board as it was; only a read the user asked for reports.
        if (options.quiet) {
          console.warn('[task-board] re-reading task-start runs failed', cause)
          return
        }
        update((current) => failTaskBoardList(current, listErrorMessage(cause)))
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null
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

  // Run changes re-read the host's cached list quietly; a list already in flight is let finish first.
  const runsTimerRef = useRef<number | null>(null)
  const rereadRuns = useCallback((): void => {
    const schedule = (): void => {
      if (runsTimerRef.current !== null) {
        return
      }
      runsTimerRef.current = window.setTimeout(() => {
        runsTimerRef.current = null
        if (controllerRef.current) {
          schedule()
          return
        }
        void load(false, { quiet: true })
      }, RUNS_REREAD_DELAY_MS)
    }
    schedule()
  }, [load])
  useEffect(() => {
    const unsubscribe = subscribeTaskBoardRunsChanged(accountHostId, rereadRuns)
    return () => {
      unsubscribe()
      if (runsTimerRef.current !== null) {
        window.clearTimeout(runsTimerRef.current)
        runsTimerRef.current = null
      }
    }
  }, [accountHostId, rereadRuns])

  // The mount load covers the first key; afterwards a settings change re-lists.
  useEffect(() => {
    const previous = loadedScopeKeyRef.current
    loadedScopeKeyRef.current = scopeKey
    if (previous !== null && previous !== scopeKey) {
      void load(false)
    }
  }, [scopeKey, load])

  return { state, refresh, reread, rereadRuns }
}
