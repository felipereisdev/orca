import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { listGitHubTaskBoardCards } from '@/lib/work-items/task-board/adapters/github-task-board-adapter'
import { listGitLabTaskBoardCards } from '@/lib/work-items/task-board/adapters/gitlab-task-board-adapter'
import { listJiraTaskBoardCards } from '@/lib/work-items/task-board/adapters/jira-task-board-adapter'
import { listLinearTaskBoardCards } from '@/lib/work-items/task-board/adapters/linear-task-board-adapter'
import { getTaskBoardProviderScopeKey } from '@/lib/work-items/task-board/adapters/task-board-provider-scope'
import {
  mergeTaskBoardProviderResult,
  type TaskBoardCardsState,
  type TaskBoardLoadOptions,
  type TaskBoardProviderResult
} from '@/lib/work-items/task-board/task-board-provider-results'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { TASK_PROVIDERS, type TaskProvider } from '../../../../../shared/work-items/task-providers'
import {
  markTaskBoardProviderLoaded,
  readTaskBoardCards,
  readTaskBoardProviderLoaded,
  writeTaskBoardCards
} from './task-board-session-cache'

/** A provider read this recently is shown from the session cache when the board mounts again. */
const MOUNT_REUSE_MS = 45_000

const PROVIDER_LOADERS: Record<
  TaskProvider,
  (
    signal: AbortSignal,
    accountHostId: ExecutionHostId,
    options: TaskBoardLoadOptions
  ) => Promise<TaskBoardProviderResult>
> = {
  github: (signal, _accountHostId, options) => listGitHubTaskBoardCards(signal, options),
  gitlab: listGitLabTaskBoardCards,
  linear: listLinearTaskBoardCards,
  jira: listJiraTaskBoardCards
}

/** Per-provider scope keys; repos hydrate per host after mount, so a provider must reload when its key changes. */
function useTaskBoardScopeKeys(): Record<TaskProvider, string> {
  const repos = useAppStore((s) => s.repos)
  const preflightStatus = useAppStore((s) => s.preflightStatus)
  const preflightStatusChecked = useAppStore((s) => s.preflightStatusChecked)
  const visibleTaskProviders = useAppStore((s) => s.settings?.visibleTaskProviders)
  // A new object only when an input changes; the reload effect still compares key strings.
  return useMemo(() => {
    const scope = { repos, preflightStatus, preflightStatusChecked, visibleTaskProviders }
    return {
      github: getTaskBoardProviderScopeKey('github', scope),
      gitlab: getTaskBoardProviderScopeKey('gitlab', scope),
      linear: getTaskBoardProviderScopeKey('linear', scope),
      jira: getTaskBoardProviderScopeKey('jira', scope)
    }
  }, [repos, preflightStatus, preflightStatusChecked, visibleTaskProviders])
}

/** `accountHostId` routes Jira and Linear: pass the Tasks page's `accountBackedTaskSourceHostId`. */
export function useTaskBoardCards(accountHostId: ExecutionHostId): {
  state: TaskBoardCardsState
  refresh: () => void
  /** A fresh read; resolves once its result reached the board (or was superseded). */
  refreshProvider: (provider: TaskProvider) => Promise<void>
} {
  // The last cards for this host show at once; the mount load then updates the stale ones.
  const [stateHostId, setStateHostId] = useState(accountHostId)
  const [state, setState] = useState(() => readTaskBoardCards(accountHostId))
  if (stateHostId !== accountHostId) {
    setStateHostId(accountHostId)
    setState(readTaskBoardCards(accountHostId))
  }
  useEffect(() => writeTaskBoardCards(stateHostId, state), [stateHostId, state])
  const controllersRef = useRef(new Map<TaskProvider, AbortController>())
  const mountedRef = useRef(false)
  const scopeKeys = useTaskBoardScopeKeys()
  const scopeKeysRef = useRef(scopeKeys)
  const loadedScopeKeysRef = useRef<Record<TaskProvider, string> | null>(null)
  useEffect(() => {
    scopeKeysRef.current = scopeKeys
  }, [scopeKeys])

  const load = useCallback(
    (provider: TaskProvider, options: TaskBoardLoadOptions) => {
      controllersRef.current.get(provider)?.abort()
      const controller = new AbortController()
      controllersRef.current.set(provider, controller)
      const scopeKey = scopeKeysRef.current[provider]
      // Previous cards and a settled status stay visible while the provider reloads.
      setState((current) => {
        const previous = current.providers[provider]
        const next = previous.status === 'loading' ? previous : { ...previous, refreshing: true }
        return { ...current, providers: { ...current.providers, [provider]: next } }
      })
      return PROVIDER_LOADERS[provider](controller.signal, accountHostId, options).then(
        (result) => {
          if (controller.signal.aborted) {
            return
          }
          markTaskBoardProviderLoaded(accountHostId, provider, { at: Date.now(), scopeKey })
          if (mountedRef.current) {
            setState((current) => mergeTaskBoardProviderResult(current, result))
            return
          }
          // Why: a move settling after the board unmounted still reloads; the next mount trusts this cache.
          const cached = readTaskBoardCards(accountHostId)
          writeTaskBoardCards(accountHostId, mergeTaskBoardProviderResult(cached, result))
        }
      )
    },
    [accountHostId]
  )

  // Refresh and post-move reloads are explicit, so they bypass provider response caches.
  const refreshProvider = useCallback(
    (provider: TaskProvider) => load(provider, { fresh: true }),
    [load]
  )
  const refresh = useCallback(() => {
    for (const provider of TASK_PROVIDERS) {
      void refreshProvider(provider)
    }
  }, [refreshProvider])

  useEffect(() => {
    const controllers = controllersRef.current
    mountedRef.current = true
    // Why: opening a card's detail and coming back must not refetch all four providers every time.
    const now = Date.now()
    const cached = readTaskBoardCards(accountHostId).providers
    for (const provider of TASK_PROVIDERS) {
      const loaded = readTaskBoardProviderLoaded(accountHostId, provider)
      const reusable =
        loaded !== undefined &&
        now - loaded.at < MOUNT_REUSE_MS &&
        loaded.scopeKey === scopeKeysRef.current[provider] &&
        cached[provider].status !== 'loading' &&
        cached[provider].refreshing !== true
      if (!reusable) {
        void load(provider, {})
      }
    }
    return () => {
      for (const controller of controllers.values()) {
        controller.abort()
      }
      controllers.clear()
      mountedRef.current = false
    }
  }, [accountHostId, load])

  // The mount load covers the first keys; afterwards only providers whose scope changed reload.
  useEffect(() => {
    const previous = loadedScopeKeysRef.current
    loadedScopeKeysRef.current = scopeKeys
    if (!previous) {
      return
    }
    for (const provider of TASK_PROVIDERS) {
      if (previous[provider] !== scopeKeys[provider]) {
        void load(provider, {})
      }
    }
  }, [scopeKeys, load])

  return { state, refresh, refreshProvider }
}
