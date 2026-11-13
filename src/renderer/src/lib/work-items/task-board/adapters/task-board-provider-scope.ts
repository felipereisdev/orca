import { useAppStore } from '@/store'
import { getRepoBackedProviderAvailability } from '@/components/task-source-provider-availability'
import {
  getDefaultTaskRepoSelection,
  getTaskEligibleRepos
} from '@/components/task-page/task-page-default-repo-selection'
import { getSettingsFocusedExecutionHostId } from '../../../../../../shared/execution-host'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  normalizeVisibleTaskProviders,
  type TaskProvider
} from '../../../../../../shared/work-items/task-providers'
import { getTaskPageRepoSourceContext } from '../../task-repo-source-context'

export function isTaskBoardProviderVisible(provider: TaskProvider): boolean {
  const settings = useAppStore.getState().settings
  return normalizeVisibleTaskProviders(settings?.visibleTaskProviders).includes(provider)
}

/** Host that owns the Jira and Linear accounts, as Cmd-J resolves it. */
export function getTaskBoardAccountHostId(): ExecutionHostId {
  return getSettingsFocusedExecutionHostId(useAppStore.getState().settings)
}

/** One repo per project (host twins would duplicate cards), skipping hosts without the provider CLI signed in. */
export function getTaskBoardRepos(provider: 'github' | 'gitlab'): Repo[] {
  const state = useAppStore.getState()
  const eligible = getTaskEligibleRepos(state.repos)
  const selected = getDefaultTaskRepoSelection(eligible)
  return eligible.filter((repo) => {
    const source = selected.has(repo.id) ? getTaskPageRepoSourceContext(repo, provider) : null
    return (
      source !== null &&
      getRepoBackedProviderAvailability({
        provider,
        contexts: [source],
        preflightStatus: state.preflightStatus,
        preflightReady: source.hostId === 'local' && state.preflightStatusChecked
      }).length === 0
    )
  })
}
