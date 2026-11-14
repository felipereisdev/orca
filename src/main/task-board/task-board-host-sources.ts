import { buildJiraPresetJql } from '../../shared/jira/jira-preset-jql'
import type { LinearIssue } from '../../shared/linear/issue-types'
import { linearPriorityLabel } from '../../shared/linear/priority-label'
import type { LinearWorkspaceError } from '../../shared/linear/workspace-types'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import {
  toJiraTaskBoardCard,
  toLinearTaskBoardCard
} from '../../shared/task-board/task-board-provider-cards'
import {
  disconnectedTaskBoardResult,
  isWithinDoneWindow,
  type TaskBoardProviderError,
  type TaskBoardProviderResult
} from '../../shared/task-board/task-board-provider-results'
import { TASK_BOARD_DONE_WINDOW_DAYS } from '../../shared/task-board/task-board-settings'
import { getStatus as getJiraStatus, isAuthError as isJiraAuthError } from '../jira/client'
import { searchIssues as searchJiraIssues } from '../jira/jira-issue-search'
import {
  getStatus as getLinearStatus,
  isAuthError as isLinearAuthError
} from '../linear/accounts/linear-account-client'
import { listIssues as listLinearIssues } from '../linear/issues/linear-issue-listing'
import type { TaskBoardListOptions, TaskBoardSources } from './task-board-host-list'
import { readGitHubTaskBoardRepos } from './task-board-host-github-source'
import {
  readGitLabTaskBoardRepos,
  type TaskBoardRepoSourceDeps
} from './task-board-host-repo-sources'
import {
  classifyTaskBoardErrorMessage,
  failedTaskBoardProvider,
  taskBoardErrorMessage
} from './task-board-provider-errors'

// Jira search caps each request at 100 issues.
const JIRA_ASSIGNED_LIMIT = 100
const JIRA_DONE_LIMIT = 50
const JIRA_DONE_JQL = `assignee = currentUser() AND statusCategory = Done AND updated >= -${TASK_BOARD_DONE_WINDOW_DAYS}d ORDER BY updated DESC`
const LINEAR_LIMIT = 100

function linearWorkspaceError(error: LinearWorkspaceError): TaskBoardProviderError {
  const code =
    error.type === 'auth'
      ? 'auth'
      : error.type === 'network' || error.type === 'rate_limited'
        ? 'unavailable'
        : 'unknown'
  return { code, message: error.message }
}

// The host has no locale; clients can relabel from `source.item.priority`.
function hostLinearPriorityLabel(priority: number): string {
  const label = linearPriorityLabel(priority)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

async function readJira({ signal }: TaskBoardListOptions): Promise<TaskBoardProviderResult> {
  const status = getJiraStatus()
  if (!status.connected) {
    return disconnectedTaskBoardResult('jira')
  }
  try {
    const [assigned, done] = await Promise.all([
      searchJiraIssues(buildJiraPresetJql('assigned'), JIRA_ASSIGNED_LIMIT, 'all', signal),
      searchJiraIssues(JIRA_DONE_JQL, JIRA_DONE_LIMIT, 'all', signal)
    ])
    const showSiteName = (status.sites?.length ?? 0) > 1
    return {
      provider: 'jira',
      status: 'ready',
      cards: [...assigned, ...done].map((issue) => toJiraTaskBoardCard(issue, showSiteName))
    }
  } catch (error) {
    const message = taskBoardErrorMessage(error)
    // Multi-site search rethrows a site's 401 as "Error 401: …", dropping the JiraApiError.
    const auth = isJiraAuthError(error) || message.startsWith('Error 401:')
    return failedTaskBoardProvider('jira', {
      code: auth ? 'auth' : classifyTaskBoardErrorMessage(message),
      message
    })
  }
}

async function readLinear(): Promise<TaskBoardProviderResult> {
  if (!getLinearStatus().connected) {
    return disconnectedTaskBoardResult('linear')
  }
  try {
    // 'completed' reads the viewer's assigned issues too, but includes canceled ones.
    const [assigned, completed] = await Promise.all([
      listLinearIssues('assigned', LINEAR_LIMIT, 'all'),
      listLinearIssues('completed', LINEAR_LIMIT, 'all')
    ])
    const now = new Date()
    const toCard = (issue: LinearIssue): TaskBoardCard =>
      toLinearTaskBoardCard(issue, hostLinearPriorityLabel)
    const cards = [
      ...assigned.items.map(toCard),
      ...completed.items.filter((issue) => isWithinDoneWindow(issue.updatedAt, now)).map(toCard)
    ].filter((card) => card.category !== 'excluded')
    const workspaceError = [...(assigned.errors ?? []), ...(completed.errors ?? [])][0]
    // A failed workspace is reported while the workspaces that loaded keep their cards.
    return workspaceError
      ? { provider: 'linear', status: 'error', cards, error: linearWorkspaceError(workspaceError) }
      : { provider: 'linear', status: 'ready', cards }
  } catch (error) {
    const message = taskBoardErrorMessage(error)
    return failedTaskBoardProvider('linear', {
      code: isLinearAuthError(error) ? 'auth' : classifyTaskBoardErrorMessage(message),
      message
    })
  }
}

/** The host's provider readers; GitHub/GitLab read only the repos the caller selected. */
export function createTaskBoardHostSources(deps: TaskBoardRepoSourceDeps): TaskBoardSources {
  return {
    jira: readJira,
    linear: () => readLinear(),
    gitlab: (repos, options) => readGitLabTaskBoardRepos(repos, options, deps),
    github: (repos, options) => readGitHubTaskBoardRepos(repos, options, deps)
  }
}
