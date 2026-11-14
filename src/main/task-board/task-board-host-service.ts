import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import type { GitHubCommentResult } from '../../shared/github/comments/comment-types'
import type { GitLabCommentResult } from '../../shared/gitlab-types'
import { resolveCategoryColumnId } from '../../shared/task-board/task-board-columns'
import {
  markTaskBoardCommentsSeen,
  type TaskBoardSeenComments
} from '../../shared/task-board/task-board-seen-comments'
import type {
  TaskBoardAddCommentResult,
  TaskBoardCardRef,
  TaskBoardDetailResult,
  TaskBoardListResult
} from '../../shared/task-board/task-board-wire-types'
import type { addIssueComment as addGitHubIssueComment } from '../github/issues/issue-comment'
import type { addIssueComment as addGitLabIssueComment } from '../gitlab/issues/gitlab-issue-queries'
import {
  enrichTaskBoardCards,
  invalidateTaskBoardCardCaches,
  readTaskBoardCardParts,
  type TaskBoardEnrichDeps
} from './task-board-enrich'
import {
  readTaskBoardCard,
  taskBoardRefKeyForRef,
  type TaskBoardCardReadDeps
} from './task-board-host-card'
import {
  buildTaskBoardList,
  placeTaskBoardCard,
  type TaskBoardHostDeps,
  type TaskBoardListOptions
} from './task-board-host-list'
import { taskBoardErrorMessage } from './task-board-provider-errors'

type ProviderWrite = { ok: true; id: string } | { ok: false; error: string }

export type TaskBoardCommentWriteDeps = {
  addJiraComment(key: string, body: string, siteId: string | null): Promise<ProviderWrite>
  addLinearComment(
    issueId: string,
    body: string,
    workspaceId: string | null
  ): Promise<ProviderWrite>
  addGitLabComment: typeof addGitLabIssueComment
  addGitHubComment: typeof addGitHubIssueComment
}

export type TaskBoardServiceDeps = TaskBoardEnrichDeps &
  TaskBoardCardReadDeps &
  TaskBoardCommentWriteDeps & {
    host: TaskBoardHostDeps
    readSeen(): TaskBoardSeenComments
    writeSeen(next: TaskBoardSeenComments): void
  }

export async function listTaskBoard(
  deps: TaskBoardServiceDeps,
  options: TaskBoardListOptions
): Promise<TaskBoardListResult> {
  const list = await buildTaskBoardList(deps.host, options)
  const cards = await enrichTaskBoardCards(list.cards, {
    todoColumnId: resolveCategoryColumnId('todo', list.columns, deps.host.settings().taskBoard),
    doneColumnId: list.doneColumnId,
    fresh: options.fresh,
    seen: deps.readSeen(),
    now: new Date(),
    deps
  })
  return { ...list, cards }
}

/** Lets the card read and the comment read of one GitHub/GitLab issue share a single request. */
function shareFirstRead<A extends unknown[], R>(
  read: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  let first: Promise<R> | undefined
  return (...args) => {
    first ??= read(...args)
    return first
  }
}

/** Always read fresh, so opening a card shows what the provider has now. */
export async function getTaskBoardDetail(
  deps: TaskBoardServiceDeps,
  ref: TaskBoardCardRef
): Promise<TaskBoardDetailResult> {
  const shared: TaskBoardServiceDeps = {
    ...deps,
    gitlabWorkItemDetails: shareFirstRead(deps.gitlabWorkItemDetails),
    githubWorkItemDetails: shareFirstRead(deps.githubWorkItemDetails)
  }
  const { taskBoard } = deps.host.settings()
  const card = placeTaskBoardCard(
    await readTaskBoardCard(ref, shared),
    deps.host.statuses(),
    taskBoard
  )
  if (!card) {
    throw new Error('This task is no longer on the board')
  }
  const workspaces = await deps.workspaces().catch(() => null)
  const [progress, comments] = await readTaskBoardCardParts(card, workspaces, true, shared)
  return {
    card,
    progress: progress.status === 'fulfilled' ? progress.value : null,
    comments: comments.status === 'fulfilled' ? comments.value : [],
    // A failed read must not pass for "no workspace" or "no comments".
    enrichment:
      progress.status === 'fulfilled' && comments.status === 'fulfilled' ? 'ok' : 'unavailable'
  }
}

function fromRepoWrite(result: GitHubCommentResult | GitLabCommentResult): ProviderWrite {
  return result.ok ? { ok: true, id: String(result.comment.id) } : result
}

async function writeComment(
  ref: TaskBoardCardRef,
  body: string,
  deps: TaskBoardServiceDeps
): Promise<ProviderWrite> {
  if (ref.provider === 'jira') {
    return deps.addJiraComment(ref.key, body, ref.siteId)
  }
  if (ref.provider === 'linear') {
    return deps.addLinearComment(ref.id, body, ref.workspaceId)
  }
  const repo = deps.repo(ref.repoId)
  if (!repo) {
    return { ok: false, error: `Repository ${ref.repoId} is no longer on this host` }
  }
  const localGit = deps.getLocalGitArgs(repo)[0] ?? {}
  // Comments go to the issue's own project/repository, never the checkout's current source.
  return ref.provider === 'gitlab'
    ? fromRepoWrite(
        await deps.addGitLabComment(
          repo.path,
          ref.number,
          body,
          repo.issueSourcePreference,
          getRepoRoutingConnectionId(repo),
          ref.projectRef,
          localGit
        )
      )
    : fromRepoWrite(
        await deps.addGitHubComment(
          repo.path,
          ref.number,
          body,
          getRepoRoutingConnectionId(repo),
          ref.issueRepo,
          localGit,
          repo.issueSourcePreference
        )
      )
}

/** Posts once and reports what the provider confirmed; no re-read, so a retry never doubles a confirmed comment. */
export async function addTaskBoardComment(
  deps: TaskBoardServiceDeps,
  ref: TaskBoardCardRef,
  body: string
): Promise<TaskBoardAddCommentResult> {
  let result: ProviderWrite
  try {
    result = await writeComment(ref, body, deps)
  } catch (error) {
    return { status: 'failed', error: taskBoardErrorMessage(error) }
  }
  if (!result.ok) {
    return { status: 'failed', error: result.error }
  }
  invalidateTaskBoardCardCaches(deps.caches, taskBoardRefKeyForRef(ref, deps))
  return { status: 'added', commentId: result.id }
}

export function markTaskBoardSeen(
  deps: TaskBoardServiceDeps,
  ref: TaskBoardCardRef,
  newest: { at: string; id: string }
): void {
  const current = deps.readSeen()
  const next = markTaskBoardCommentsSeen(current, taskBoardRefKeyForRef(ref, deps), newest)
  if (next !== current) {
    deps.writeSeen(next)
  }
}
