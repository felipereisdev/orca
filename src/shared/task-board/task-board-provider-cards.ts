import type { GitHubWorkItem } from '../github/work-items/work-item-types'
import type { GitLabWorkItem, GitLabWorkItemStatus } from '../gitlab/gitlab-types'
import type { JiraIssue } from '../jira/jira-types'
import type { LinearIssue } from '../linear/issue-types'
import type { ExecutionHostId } from '../execution-host/execution-host'
import {
  jiraStatusCategory,
  linearStatusCategory,
  openClosedStatusCategory,
  type TaskBoardCard
} from './task-board-card'
import type { TaskBoardCardRef } from './task-board-wire-types'

/** The card's identity for markers and caches; `repoHostId` is the executing host of a GitHub/GitLab card's repo. */
export function taskBoardRefKey(
  ref: TaskBoardCardRef,
  repoHostId: ExecutionHostId | null | undefined
): string {
  switch (ref.provider) {
    case 'jira':
      return `jira:${ref.siteId ?? ''}:${ref.key}`
    case 'linear':
      return `linear:${ref.workspaceId ?? ''}:${ref.id}`
    case 'gitlab':
      return `gitlab:${repoHostId ?? ''}:${ref.projectRef?.path ?? ref.repoId}:${ref.number}`
    case 'github':
      return `github:${repoHostId ?? ''}:${ref.repoId}:${ref.number}`
  }
}

export function toJiraTaskBoardCard(issue: JiraIssue, showSiteName = false): TaskBoardCard {
  return {
    refKey: taskBoardRefKey(
      { provider: 'jira', siteId: issue.siteId ?? null, key: issue.key },
      null
    ),
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
    refKey: taskBoardRefKey(
      {
        provider: 'linear',
        workspaceId: issue.workspaceId ?? null,
        id: issue.id,
        teamId: issue.team.id
      },
      null
    ),
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

export function toGitLabTaskBoardCard(
  item: GitLabWorkItem,
  repoLabel: string,
  workItemStatus: GitLabWorkItemStatus | null = null
): TaskBoardCard {
  return {
    refKey: taskBoardRefKey(
      {
        provider: 'gitlab',
        repoId: item.repoId,
        number: item.number,
        projectRef: item.projectRef ?? null
      },
      item.repoHostId
    ),
    provider: 'gitlab',
    displayId: `#${item.number}`,
    title: item.title,
    url: item.url,
    projectLabel: repoLabel,
    statusName: workItemStatus?.name ?? item.state,
    category: openClosedStatusCategory(item.state),
    labels: item.labels,
    ...(workItemStatus ? { workItemStatus } : {}),
    updatedAt: item.updatedAt,
    source: { provider: 'gitlab', item }
  }
}

/** The GitLab card as it reads with `workItemStatus`; other cards unchanged. */
export function withGitLabWorkItemStatus(
  card: TaskBoardCard,
  workItemStatus: GitLabWorkItemStatus | null
): TaskBoardCard {
  return card.source.provider === 'gitlab'
    ? toGitLabTaskBoardCard(card.source.item, card.projectLabel, workItemStatus)
    : card
}

export function toGitHubTaskBoardCard(item: GitHubWorkItem, repoLabel: string): TaskBoardCard {
  return {
    refKey: taskBoardRefKey(
      { provider: 'github', repoId: item.repoId, number: item.number, issueRepo: null },
      item.repoHostId
    ),
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
