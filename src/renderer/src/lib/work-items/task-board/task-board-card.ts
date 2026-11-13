import type { GitHubWorkItem } from '../../../../../shared/github/work-items/work-item-types'
import type { GitLabWorkItem } from '../../../../../shared/gitlab-types'
import type { JiraIssue } from '../../../../../shared/jira/jira-types'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

export type TaskBoardStatusCategory = 'todo' | 'in-progress' | 'done' | 'excluded'

export type TaskBoardCardSource =
  | { provider: 'jira'; item: JiraIssue }
  | { provider: 'linear'; item: LinearIssue }
  | { provider: 'gitlab'; item: GitLabWorkItem }
  | { provider: 'github'; item: GitHubWorkItem }

export type TaskBoardCard = {
  /** `${provider}:${scope}:${id}`, unique across providers, sites and hosts. */
  refKey: string
  provider: TaskProvider
  displayId: string
  title: string
  url: string
  projectLabel: string
  statusName: string
  category: TaskBoardStatusCategory
  labels: string[]
  priorityLabel?: string
  updatedAt: string
  source: TaskBoardCardSource
}

export function jiraStatusCategory(categoryKey: string): TaskBoardStatusCategory {
  if (categoryKey === 'indeterminate') {
    return 'in-progress'
  }
  return categoryKey === 'done' ? 'done' : 'todo'
}

export function linearStatusCategory(type: string): TaskBoardStatusCategory {
  switch (type) {
    case 'started':
      return 'in-progress'
    case 'completed':
      return 'done'
    case 'canceled':
      return 'excluded'
    default:
      return 'todo'
  }
}

export function openClosedStatusCategory(state: string): TaskBoardStatusCategory {
  return state === 'closed' ? 'done' : 'todo'
}
