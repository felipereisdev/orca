import type { GitHubWorkItem } from '../github/work-items/work-item-types'
import type { GitLabWorkItem } from '../gitlab-types'
import type { JiraIssue } from '../jira/jira-types'
import type { LinearIssue } from '../linear/issue-types'
import {
  jiraStatusCategory,
  linearStatusCategory,
  openClosedStatusCategory,
  type TaskBoardCard
} from './task-board-card'

export function toJiraTaskBoardCard(issue: JiraIssue, showSiteName = false): TaskBoardCard {
  return {
    refKey: `jira:${issue.siteId ?? ''}:${issue.key}`,
    provider: 'jira',
    displayId: issue.key,
    title: issue.title,
    url: issue.url,
    projectLabel:
      showSiteName && issue.siteName
        ? `${issue.project.key} · ${issue.siteName}`
        : issue.project.key,
    statusName: issue.status.name,
    category: jiraStatusCategory(issue.status.categoryKey),
    labels: issue.labels,
    ...(issue.priority?.name ? { priorityLabel: issue.priority.name } : {}),
    updatedAt: issue.updatedAt,
    source: { provider: 'jira', item: issue }
  }
}

/** `priorityLabel` names Linear's numeric priority; the renderer localizes it, the host cannot. */
export function toLinearTaskBoardCard(
  issue: LinearIssue,
  priorityLabel: (priority: number) => string
): TaskBoardCard {
  return {
    refKey: `linear:${issue.workspaceId ?? ''}:${issue.id}`,
    provider: 'linear',
    displayId: issue.identifier,
    title: issue.title,
    url: issue.url,
    projectLabel: issue.project?.name ?? issue.team.key,
    statusName: issue.state.name,
    category: linearStatusCategory(issue.state.type),
    labels: issue.labels,
    ...(issue.priority > 0 ? { priorityLabel: priorityLabel(issue.priority) } : {}),
    updatedAt: issue.updatedAt,
    source: { provider: 'linear', item: issue }
  }
}

export function toGitLabTaskBoardCard(item: GitLabWorkItem, repoLabel: string): TaskBoardCard {
  return {
    refKey: `gitlab:${item.repoHostId ?? ''}:${item.projectRef?.path ?? item.repoId}:${item.number}`,
    provider: 'gitlab',
    displayId: `#${item.number}`,
    title: item.title,
    url: item.url,
    projectLabel: repoLabel,
    statusName: item.state,
    category: openClosedStatusCategory(item.state),
    labels: item.labels,
    updatedAt: item.updatedAt,
    source: { provider: 'gitlab', item }
  }
}

export function toGitHubTaskBoardCard(item: GitHubWorkItem, repoLabel: string): TaskBoardCard {
  return {
    refKey: `github:${item.repoHostId ?? ''}:${item.repoId}:${item.number}`,
    provider: 'github',
    displayId: `#${item.number}`,
    title: item.title,
    url: item.url,
    projectLabel: repoLabel,
    statusName: item.state,
    category: openClosedStatusCategory(item.state),
    labels: item.labels,
    updatedAt: item.updatedAt,
    source: { provider: 'github', item }
  }
}
