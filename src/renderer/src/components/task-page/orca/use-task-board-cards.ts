import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { listGitHubTaskBoardCards } from '@/lib/work-items/task-board/adapters/github-task-board-adapter'
import { listGitLabTaskBoardCards } from '@/lib/work-items/task-board/adapters/gitlab-task-board-adapter'
import { listJiraTaskBoardCards } from '@/lib/work-items/task-board/adapters/jira-task-board-adapter'
import { listLinearTaskBoardCards } from '@/lib/work-items/task-board/adapters/linear-task-board-adapter'
import { getTaskBoardProviderScopeKey } from '@/lib/work-items/task-board/adapters/task-board-provider-scope'
import {
  emptyTaskBoardCardsState,
  mergeTaskBoardProviderResult,
  type TaskBoardCardsState,
  type TaskBoardProviderResult
} from '@/lib/work-items/task-board/task-board-provider-results'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { TASK_PROVIDERS, type TaskProvider } from '../../../../../shared/work-items/task-providers'

const PROVIDER_LOADERS: Record<
  TaskProvider,
  (signal: AbortSignal, accountHostId: ExecutionHostId) => Promise<TaskBoardProviderResult>
> = {
  github: listGitHubTaskBoardCards,
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
  refreshProvider: (provider: TaskProvider) => void
} {
  const [state, setState] = useState(emptyTaskBoardCardsState)
  const controllersRef = useRef(new Map<TaskProvider, AbortController>())
  const scopeKeys = useTaskBoardScopeKeys()
  const loadedScopeKeysRef = useRef<Record<TaskProvider, string> | null>(null)

  const refreshProvider = useCallback(
    (provider: TaskProvider) => {
      controllersRef.current.get(provider)?.abort()
      const controller = new AbortController()
      controllersRef.current.set(provider, controller)
      // Previous cards stay visible while the provider reloads.
      setState((current) => ({
        ...current,
        providers: { ...current.providers, [provider]: { status: 'loading' } }
      }))
      void PROVIDER_LOADERS[provider](controller.signal, accountHostId).then((result) => {
        if (!controller.signal.aborted) {
          setState((current) => mergeTaskBoardProviderResult(current, result))
        }
      })
    },
    [accountHostId]
  )

  const refresh = useCallback(() => {
    for (const provider of TASK_PROVIDERS) {
      refreshProvider(provider)
    }
  }, [refreshProvider])

  useEffect(() => {
    const controllers = controllersRef.current
    refresh()
    return () => {
      for (const controller of controllers.values()) {
        controller.abort()
      }
      controllers.clear()
    }
  }, [refresh])

  // The mount load covers the first keys; afterwards only providers whose scope changed reload.
  useEffect(() => {
    const previous = loadedScopeKeysRef.current
    loadedScopeKeysRef.current = scopeKeys
    if (!previous) {
      return
    }
    for (const provider of TASK_PROVIDERS) {
      if (previous[provider] !== scopeKeys[provider]) {
        refreshProvider(provider)
      }
    }
  }, [scopeKeys, refreshProvider])

  return { state, refresh, refreshProvider }
}
