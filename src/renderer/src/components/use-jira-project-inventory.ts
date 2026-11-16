import type { JiraProject } from '../../../shared/jira/jira-types'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { TaskSourceContext } from '../../../shared/work-items/task-source-context'
import { taskSourceRuntimeTarget } from '@/lib/work-items/task-source-runtime-target'
import {
  jiraListProjectsForTarget,
  jiraStatusForTarget
} from '@/runtime/jira/runtime-jira-project-client'
import {
  useProviderProjectInventory,
  type ProviderProjectInventoryRead
} from './provider-project-inventory'

type JiraProjectInventorySource = RuntimeClientTarget | TaskSourceContext

async function readJiraProjects(
  source: JiraProjectInventorySource
): Promise<ProviderProjectInventoryRead<JiraProject>> {
  const target = source.kind === 'task-source' ? taskSourceRuntimeTarget(source) : source
  const status = await jiraStatusForTarget(target)
  return {
    connected: status.connected,
    projects: status.connected ? await jiraListProjectsForTarget(target, 'all') : []
  }
}

export function useJiraProjectInventory(source: JiraProjectInventorySource, enabled: boolean) {
  return useProviderProjectInventory(source, enabled, readJiraProjects)
}
