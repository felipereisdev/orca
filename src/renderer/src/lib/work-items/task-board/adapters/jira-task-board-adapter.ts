import { failedTaskBoardResult } from './task-board-failed-result'
import { jiraSearchIssuesForTarget } from '@/runtime/jira/runtime-jira-client'
import { jiraStatusForTarget } from '@/runtime/jira/runtime-jira-project-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { buildJiraPresetJql } from '../../../../../../shared/jira/jira-preset-jql'
import { resolveJiraSourceHostId } from '../../../../../../shared/jira/jira-source-host'
import { toJiraTaskBoardCard } from '../../../../../../shared/task-board/task-board-provider-cards'
import {
  disconnectedTaskBoardResult,
  type TaskBoardProviderResult
} from '../../../../../../shared/task-board/task-board-provider-results'
import { isTaskBoardProviderVisible } from './task-board-provider-scope'

// Jira search caps each request at 100 issues.
const ASSIGNED_LIMIT = 100
const DONE_LIMIT = 50
const DONE_JQL =
  'assignee = currentUser() AND statusCategory = Done AND updated >= -14d ORDER BY updated DESC'

/** Where the board reads and writes Jira for the Tasks page's account-backed host. */
export function resolveJiraTaskBoardTarget(
  accountHostId: ExecutionHostId
): RuntimeClientTarget | null {
  // Jira credentials stay on the desktop for SSH hosts; runtime hosts own theirs.
  return ipcOrRuntimeTargetForHostId(resolveJiraSourceHostId({ workspaceHostId: accountHostId }))
}

async function readJiraCards(
  signal: AbortSignal,
  accountHostId: ExecutionHostId
): Promise<TaskBoardProviderResult> {
  if (!isTaskBoardProviderVisible('jira')) {
    return disconnectedTaskBoardResult('jira')
  }
  const target = resolveJiraTaskBoardTarget(accountHostId)
  if (!target) {
    return disconnectedTaskBoardResult('jira')
  }
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
}

/** `accountHostId` is the Tasks page's account-backed source host (Cmd-J's `accountBackedTaskSourceHostId`). */
export async function listJiraTaskBoardCards(
  signal: AbortSignal,
  accountHostId: ExecutionHostId
): Promise<TaskBoardProviderResult> {
  try {
    return await readJiraCards(signal, accountHostId)
  } catch (error) {
    return failedTaskBoardResult('jira', error)
  }
}
