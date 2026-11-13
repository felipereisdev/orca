import { useCallback, useEffect, useRef, useState } from 'react'
import { listGitHubTaskBoardCards } from '@/lib/work-items/task-board/adapters/github-task-board-adapter'
import { listGitLabTaskBoardCards } from '@/lib/work-items/task-board/adapters/gitlab-task-board-adapter'
import { listJiraTaskBoardCards } from '@/lib/work-items/task-board/adapters/jira-task-board-adapter'
import { listLinearTaskBoardCards } from '@/lib/work-items/task-board/adapters/linear-task-board-adapter'
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

/** `accountHostId` routes Jira and Linear: pass the Tasks page's `accountBackedTaskSourceHostId`. */
export function useTaskBoardCards(accountHostId: ExecutionHostId): {
  state: TaskBoardCardsState
  refresh: () => void
  refreshProvider: (provider: TaskProvider) => void
} {
  const [state, setState] = useState(emptyTaskBoardCardsState)
  const controllersRef = useRef(new Map<TaskProvider, AbortController>())

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

  return { state, refresh, refreshProvider }
}
