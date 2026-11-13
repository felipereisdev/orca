import { jiraSearchIssuesForTarget } from '@/runtime/jira/runtime-jira-client'
import { jiraStatusForTarget } from '@/runtime/jira/runtime-jira-project-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import { buildJiraPresetJql } from '../../../../../../shared/jira/jira-preset-jql'
import { resolveJiraSourceHostId } from '../../../../../../shared/jira/jira-source-host'
import type { JiraIssue } from '../../../../../../shared/jira/jira-types'
import { jiraStatusCategory, type TaskBoardCard } from '../task-board-card'
import {
  disconnectedTaskBoardResult,
  failedTaskBoardResult,
  type TaskBoardProviderResult
} from '../task-board-provider-results'
import { getTaskBoardAccountHostId, isTaskBoardProviderVisible } from './task-board-provider-scope'

// Jira search caps each request at 100 issues.
const ASSIGNED_LIMIT = 100
const DONE_LIMIT = 50
const DONE_JQL =
  'assignee = currentUser() AND statusCategory = Done AND updated >= -14d ORDER BY updated DESC'

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

export async function listJiraTaskBoardCards(
  signal: AbortSignal
): Promise<TaskBoardProviderResult> {
  if (!isTaskBoardProviderVisible('jira')) {
    return disconnectedTaskBoardResult('jira')
  }
  // Jira credentials stay on the desktop for SSH hosts; runtime hosts own theirs.
  const target = ipcOrRuntimeTargetForHostId(
    resolveJiraSourceHostId({ workspaceHostId: getTaskBoardAccountHostId() })
  )
  if (!target) {
    return disconnectedTaskBoardResult('jira')
  }
  try {
    const status = await jiraStatusForTarget(target)
    if (!status.connected) {
      return disconnectedTaskBoardResult('jira')
    }
    const [assigned, done] = await Promise.all([
      jiraSearchIssuesForTarget(
        target,
        buildJiraPresetJql('assigned'),
        ASSIGNED_LIMIT,
        'all',
        signal
      ),
      jiraSearchIssuesForTarget(target, DONE_JQL, DONE_LIMIT, 'all', signal)
    ])
    const showSiteName = (status.sites?.length ?? 0) > 1
    return {
      provider: 'jira',
      status: 'ready',
      cards: [...assigned, ...done].map((issue) => toJiraTaskBoardCard(issue, showSiteName))
    }
  } catch (error) {
    return failedTaskBoardResult('jira', error)
  }
}
