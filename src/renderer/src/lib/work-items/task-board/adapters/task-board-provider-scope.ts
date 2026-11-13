import { useAppStore } from '@/store'
import { getRepoBackedProviderAvailability } from '@/components/task-source-provider-availability'
import {
  getDefaultTaskRepoSelection,
  getTaskEligibleRepos
} from '@/components/task-page/task-page-default-repo-selection'
import type { PreflightStatus } from '../../../../../../preload/api/preflight-api'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  normalizeVisibleTaskProviders,
  type TaskProvider
} from '../../../../../../shared/work-items/task-providers'
import { getTaskPageRepoSourceContext } from '../../task-repo-source-context'

/** Store inputs that decide which providers and repos the board reads. */
export type TaskBoardScopeInput = {
  repos: readonly Repo[]
  preflightStatus: PreflightStatus | null
  preflightStatusChecked: boolean
  visibleTaskProviders: unknown
}

function readTaskBoardScopeInput(): TaskBoardScopeInput {
  const state = useAppStore.getState()
  return {
    repos: state.repos,
    preflightStatus: state.preflightStatus,
    preflightStatusChecked: state.preflightStatusChecked,
    visibleTaskProviders: state.settings?.visibleTaskProviders
  }
}

export function isTaskBoardProviderVisible(
  provider: TaskProvider,
  scope: TaskBoardScopeInput = readTaskBoardScopeInput()
): boolean {
  return normalizeVisibleTaskProviders(scope.visibleTaskProviders).includes(provider)
}

/**
 * One repo per project (host twins would duplicate cards), skipping hosts without the provider
 * CLI signed in. Empty when the provider is hidden.
 */
export function getTaskBoardRepos(
  provider: 'github' | 'gitlab',
  scope: TaskBoardScopeInput = readTaskBoardScopeInput()
): Repo[] {
  if (!isTaskBoardProviderVisible(provider, scope)) {
    return []
  }
  const eligible = getTaskEligibleRepos(scope.repos)
  const selected = getDefaultTaskRepoSelection(eligible)
  return eligible.filter((repo) => {
    const source = selected.has(repo.id) ? getTaskPageRepoSourceContext(repo, provider) : null
    return (
      source !== null &&
      getRepoBackedProviderAvailability({
        provider,
        contexts: [source],
        preflightStatus: scope.preflightStatus,
        preflightReady: source.hostId === 'local' && scope.preflightStatusChecked
      }).length === 0
    )
  })
}

/** Changes exactly when the provider's read would cover a different scope. */
export function getTaskBoardProviderScopeKey(
  provider: TaskProvider,
  scope: TaskBoardScopeInput
): string {
  if (provider === 'jira' || provider === 'linear') {
    return isTaskBoardProviderVisible(provider, scope) ? 'visible' : 'hidden'
  }
  return JSON.stringify(
    getTaskBoardRepos(provider, scope).map((repo) => [
      repo.id,
      getRepoExecutionHostId(repo),
      repo.path
    ])
  )
}
