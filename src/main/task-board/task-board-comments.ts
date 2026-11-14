import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import type { PRComment } from '../../shared/github/comments/comment-types'
import type { MRComment } from '../../shared/gitlab-types'
import type { JiraComment, JiraSite } from '../../shared/jira/jira-types'
import type { LinearComment } from '../../shared/linear/issue-types'
import type { Repo } from '../../shared/repo-types'
import type {
  TaskBoardCardRef,
  TaskBoardComment,
  TaskBoardWireCard
} from '../../shared/task-board/task-board-wire-types'
import type { getWorkItemDetails as getGitHubWorkItemDetails } from '../github/work-items/work-item-details'
import type { getWorkItemDetails as getGitLabWorkItemDetails } from '../gitlab/work-items/work-item-details'
import type { LocalProjectGhExecOptions } from '../workspaces/execution-host/project-runtime-git-options'

/** Every reader must throw on a failed read: answering [] would pass for "no comments". */
export type TaskBoardCommentDeps = {
  repo(repoId: string): Repo | null
  getLocalGitArgs(repo: Repo): [] | [LocalProjectGhExecOptions]
  jiraSites(): readonly Pick<JiraSite, 'id' | 'accountId'>[]
  jiraComments(key: string, siteId: string | null): Promise<JiraComment[]>
  linearComments(issueId: string, workspaceId: string | null): Promise<LinearComment[]>
  linearViewerId(workspaceId: string | null): Promise<string>
  // These two answer null on failure; the reader below turns that into a throw.
  gitlabWorkItemDetails: typeof getGitLabWorkItemDetails
  githubWorkItemDetails: typeof getGitHubWorkItemDetails
}

type RepoRef = Extract<TaskBoardCardRef, { provider: 'github' | 'gitlab' }>

function requireRepo(ref: RepoRef, deps: TaskBoardCommentDeps): Repo {
  const repo = deps.repo(ref.repoId)
  if (!repo) {
    throw new Error(`Repository ${ref.repoId} is no longer on this host`)
  }
  return repo
}

function fromRepoComment(comment: PRComment | MRComment): TaskBoardComment {
  return {
    id: String(comment.id),
    author: comment.author,
    at: comment.createdAt,
    body: comment.body,
    own: comment.viewerDidAuthor === true
  }
}

async function readJira(
  ref: Extract<TaskBoardCardRef, { provider: 'jira' }>,
  deps: TaskBoardCommentDeps
): Promise<TaskBoardComment[]> {
  const comments = await deps.jiraComments(ref.key, ref.siteId)
  // Each site has its own login, so only the issue's site's account is the user.
  const accountIds = new Set(
    deps
      .jiraSites()
      .filter((site) => ref.siteId === null || site.id === ref.siteId)
      .map((site) => site.accountId)
  )
  return comments.map((comment) => ({
    id: comment.id,
    author: comment.user?.displayName ?? '',
    at: comment.createdAt,
    body: comment.body,
    own: comment.user !== undefined && accountIds.has(comment.user.accountId)
  }))
}

async function readLinear(
  ref: Extract<TaskBoardCardRef, { provider: 'linear' }>,
  deps: TaskBoardCommentDeps
): Promise<TaskBoardComment[]> {
  const [comments, viewerId] = await Promise.all([
    deps.linearComments(ref.id, ref.workspaceId),
    deps.linearViewerId(ref.workspaceId)
  ])
  return comments.map((comment) => ({
    id: comment.id,
    author: comment.user?.displayName ?? '',
    at: comment.createdAt,
    body: comment.body,
    own: comment.user?.id !== undefined && comment.user.id === viewerId
  }))
}

async function readGitLab(
  ref: Extract<TaskBoardCardRef, { provider: 'gitlab' }>,
  deps: TaskBoardCommentDeps
): Promise<TaskBoardComment[]> {
  const repo = requireRepo(ref, deps)
  // The ref's project pins the issue's source; the checkout's current source may differ.
  const details = await deps.gitlabWorkItemDetails(
    repo.path,
    ref.number,
    'issue',
    repo.issueSourcePreference,
    getRepoRoutingConnectionId(repo),
    ref.projectRef,
    deps.getLocalGitArgs(repo)[0] ?? {},
    { markViewerComments: true }
  )
  if (!details) {
    throw new Error(`GitLab issue #${ref.number} could not be read`)
  }
  return details.comments.map(fromRepoComment)
}

async function readGitHub(
  ref: Extract<TaskBoardCardRef, { provider: 'github' }>,
  fresh: boolean,
  deps: TaskBoardCommentDeps
): Promise<TaskBoardComment[]> {
  const repo = requireRepo(ref, deps)
  const details = await deps.githubWorkItemDetails(
    repo.path,
    ref.number,
    'issue',
    getRepoRoutingConnectionId(repo),
    deps.getLocalGitArgs(repo)[0] ?? {},
    repo.issueSourcePreference,
    ref.issueRepo ?? undefined,
    // Canonical reads skip gh's cache and fail instead of collapsing to empty.
    fresh
  )
  if (!details) {
    throw new Error(`GitHub issue #${ref.number} could not be read`)
  }
  return details.comments.map(fromRepoComment)
}

/** The card's comments, oldest first, with `own` set for the user's account on the issue's source. */
export async function readTaskBoardComments(
  card: Pick<TaskBoardWireCard, 'ref'>,
  options: { fresh: boolean },
  deps: TaskBoardCommentDeps
): Promise<TaskBoardComment[]> {
  const { ref } = card
  const comments =
    ref.provider === 'jira'
      ? await readJira(ref, deps)
      : ref.provider === 'linear'
        ? await readLinear(ref, deps)
        : ref.provider === 'gitlab'
          ? await readGitLab(ref, deps)
          : await readGitHub(ref, options.fresh, deps)
  // An unparseable timestamp sorts first instead of poisoning the comparator with NaN.
  return comments.toSorted((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))
}
