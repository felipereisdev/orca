import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId
} from '../../shared/execution-host/execution-host'
import type { JiraIssue } from '../../shared/jira/jira-types'
import type { LinearIssue } from '../../shared/linear/issue-types'
import { parseGitLabIssueOrMRLink } from '../../shared/new-workspace/gitlab-links'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import {
  taskBoardRefKey,
  toGitHubTaskBoardCard,
  toGitLabTaskBoardCard,
  toJiraTaskBoardCard,
  toLinearTaskBoardCard
} from '../../shared/task-board/task-board-provider-cards'
import type { TaskBoardCardRef } from '../../shared/task-board/task-board-wire-types'
import type { getWorkItemStatuses as getGitLabWorkItemStatuses } from '../gitlab/work-items/work-item-status'
import {
  readTaskBoardGitHubIssue,
  readTaskBoardGitLabIssue,
  type TaskBoardCommentDeps
} from './task-board-comments'
import { hostLinearPriorityLabel } from './task-board-host-sources'

/** Single-issue readers; each must throw (or answer null) when the issue cannot be read. */
export type TaskBoardCardReadDeps = TaskBoardCommentDeps & {
  jiraIssue(key: string, siteId: string | null): Promise<JiraIssue | null>
  /** The listing names the site on cards only when several are connected. */
  jiraSiteCount(): Promise<number>
  linearIssue(id: string, workspaceId: string | null): Promise<LinearIssue | null>
  gitlabWorkItemStatuses: typeof getGitLabWorkItemStatuses
}

/** How a GitLab card read treats the work item Status: `required` fails the read when GitLab
 *  cannot answer (an instance without statuses still reads); `best-effort` falls back to labels. */
export type TaskBoardCardReadOptions = { workItemStatus?: 'required' | 'best-effort' | 'skip' }

function unreadable(ref: TaskBoardCardRef): Error {
  const name = ref.provider === 'jira' ? ref.key : ref.provider === 'linear' ? ref.id : ref.number
  return new Error(`${ref.provider} issue ${name} could not be read`)
}

/** The card's key for markers and caches, without reading the issue. */
export function taskBoardRefKeyForRef(ref: TaskBoardCardRef, deps: TaskBoardCommentDeps): string {
  if (ref.provider === 'jira' || ref.provider === 'linear') {
    return taskBoardRefKey(ref, null)
  }
  const repo = deps.repo(ref.repoId)
  if (!repo) {
    throw new Error(`Repository ${ref.repoId} is no longer on this host`)
  }
  return taskBoardRefKey(ref, getRepoExecutionHostId(repo))
}

/** One issue read by its ref, shaped like the listing's card so its refKey matches. */
export async function readTaskBoardCard(
  ref: TaskBoardCardRef,
  deps: TaskBoardCardReadDeps,
  options: TaskBoardCardReadOptions = {}
): Promise<TaskBoardCard> {
  switch (ref.provider) {
    case 'jira': {
      const issue = await deps.jiraIssue(ref.key, ref.siteId)
      if (!issue) {
        throw unreadable(ref)
      }
      return toJiraTaskBoardCard(
        { ...issue, siteId: issue.siteId ?? ref.siteId ?? undefined },
        (await deps.jiraSiteCount()) > 1
      )
    }
    case 'linear': {
      const issue = await deps.linearIssue(ref.id, ref.workspaceId)
      if (!issue) {
        throw unreadable(ref)
      }
      return toLinearTaskBoardCard(
        { ...issue, workspaceId: issue.workspaceId ?? ref.workspaceId ?? undefined },
        hostLinearPriorityLabel
      )
    }
    case 'gitlab': {
      const { repo, details } = await readTaskBoardGitLabIssue(ref, deps)
      const { projectRef: _detailsProjectRef, ...item } = details.item
      // Same project pin as the listing, which reads it from the issue URL.
      const projectRef = parseGitLabIssueOrMRLink(item.url)?.slug ?? ref.projectRef
      const mode = options.workItemStatus ?? 'required'
      const statuses =
        projectRef && mode !== 'skip'
          ? await deps.gitlabWorkItemStatuses(
              repo.path,
              projectRef,
              [ref.number],
              getRepoRoutingConnectionId(repo),
              deps.getLocalGitArgs(repo)[0] ?? {}
            )
          : null
      // Without its Status the card would resolve by labels, and a move would edit them.
      if (statuses?.kind === 'failed' && mode === 'required') {
        throw new Error(statuses.error)
      }
      return toGitLabTaskBoardCard(
        {
          ...item,
          id: `gitlab-issue-${repo.id}-${ref.number}`,
          repoId: repo.id,
          repoHostId: getRepoExecutionHostId(repo),
          ...(projectRef ? { projectRef } : {})
        },
        repo.displayName,
        statuses?.kind === 'statuses' ? (statuses.statuses.get(ref.number) ?? null) : null
      )
    }
    case 'github': {
      const { repo, details } = await readTaskBoardGitHubIssue(ref, deps)
      return toGitHubTaskBoardCard(
        { ...details.item, repoId: repo.id, repoHostId: getRepoExecutionHostId(repo) },
        repo.displayName
      )
    }
  }
}
