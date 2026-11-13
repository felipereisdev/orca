import type { TaskPageData } from '@/store/slices/ui/ui-slice-contract-core'
import { isOrcaTaskSource, type TaskSource } from '../../../../shared/work-items/task-source'

/** Added by a detail opener: a detail opened from My board returns there; provider tabs keep their own. */
export function taskDetailReturnFields(
  currentSource: TaskSource
): Pick<TaskPageData, 'detailReturnTaskSource'> {
  return isOrcaTaskSource(currentSource) ? { detailReturnTaskSource: currentSource } : {}
}

/** Page data once a detail closes: nothing open, back on the source the detail was opened from. */
export function closeTaskPageDetail(data: TaskPageData): TaskPageData {
  return {
    ...data,
    taskSource: data.detailReturnTaskSource ?? data.taskSource,
    openGitHubWorkItem: undefined,
    openGitHubSourceContext: undefined,
    openGitHubInitialTab: undefined,
    openGitLabWorkItem: undefined,
    openGitLabSourceContext: undefined,
    openLinearIssue: undefined,
    openLinearSourceContext: undefined,
    openJiraIssue: undefined,
    openJiraSourceContext: undefined
  }
}
