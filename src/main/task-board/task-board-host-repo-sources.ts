import { getRepoExecutionHostId, getRepoRoutingConnectionId } from '../../shared/execution-host'
import type { ClassifiedError } from '../../shared/classified-error'
import type { GitHubWorkItem } from '../../shared/github/work-items/work-item-types'
import type { GitLabWorkItem } from '../../shared/gitlab-types'
import { mapSettledWithConcurrency } from '../../shared/map-with-concurrency'
import { parseGitLabIssueOrMRLink } from '../../shared/new-workspace/gitlab-links'
import type { Repo } from '../../shared/repo-types'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import {
  toGitHubTaskBoardCard,
  toGitLabTaskBoardCard
} from '../../shared/task-board/task-board-provider-cards'
import {
  isWithinDoneWindow,
  type TaskBoardProviderError,
  type TaskBoardProviderResult
} from '../../shared/task-board/task-board-provider-results'
import { TASK_BOARD_DONE_WINDOW_DAYS } from '../../shared/task-board/task-board-settings'
import { listWorkItems } from '../github/client/list/list-work-items'
import { listIssues as listGitLabIssues } from '../gitlab/issues/gitlab-issue-queries'
import type { LocalProjectGhExecOptions } from '../workspaces/execution-host/project-runtime-git-options'
import type { TaskBoardListOptions } from './task-board-host-list'
import {
  classifyTaskBoardErrorMessage,
  failedTaskBoardProvider,
  taskBoardErrorMessage
} from './task-board-provider-errors'

const OPEN_LIMIT = 50
const CLOSED_LIMIT = 20
// Leave headroom below the CLI operation slots, as the GitLab task list does.
const REPO_FETCH_CONCURRENCY = 6
const DAY_MS = 24 * 60 * 60 * 1000

export type TaskBoardRepoSourceDeps = {
  getLocalGitArgs(repo: Repo): [] | [LocalProjectGhExecOptions]
}

type RepoRead = { cards: TaskBoardCard[] } | { skipped: true } | { error: TaskBoardProviderError }
type RepoReader = (repo: Repo, now: Date) => Promise<RepoRead>

function repoError(error: ClassifiedError): TaskBoardProviderError {
  const transport = error.type === 'network_error' || error.type === 'rate_limited'
  return {
    code: transport ? 'unavailable' : classifyTaskBoardErrorMessage(error.message),
    message: error.message
  }
}

/** A partial failure keeps the repos that loaded; only an all-failed provider reports an error. */
async function readRepos(
  provider: 'github' | 'gitlab',
  repos: readonly Repo[],
  { signal }: TaskBoardListOptions,
  readRepo: RepoReader
): Promise<TaskBoardProviderResult> {
  const now = new Date()
  const results = await mapSettledWithConcurrency(repos, REPO_FETCH_CONCURRENCY, (repo) =>
    signal?.aborted ? Promise.resolve<RepoRead>({ skipped: true }) : readRepo(repo, now)
  )
  const cards: TaskBoardCard[] = []
  const errors: TaskBoardProviderError[] = []
  let loadedRepos = 0
  for (const result of results) {
    if (result.status === 'rejected') {
      const message = taskBoardErrorMessage(result.reason)
      errors.push({ code: classifyTaskBoardErrorMessage(message), message })
    } else if ('error' in result.value) {
      errors.push(result.value.error)
    } else if ('cards' in result.value) {
      loadedRepos += 1
      cards.push(...result.value.cards)
    }
  }
  if (errors.length > 0 && loadedRepos === 0) {
    return failedTaskBoardProvider(provider, errors[0])
  }
  return { provider, status: 'ready', cards }
}

function gitLabRepoReader(deps: TaskBoardRepoSourceDeps): RepoReader {
  return async (repo, now) => {
    const list = (state: 'opened' | 'closed', limit: number) =>
      listGitLabIssues(
        repo.path,
        limit,
        repo.issueSourcePreference,
        state,
        '@me',
        getRepoRoutingConnectionId(repo),
        deps.getLocalGitArgs(repo)[0] ?? {}
      )
    const [opened, closed] = await Promise.all([
      list('opened', OPEN_LIMIT),
      list('closed', CLOSED_LIMIT)
    ])
    // Non-GitLab repos answer not_found; they are simply not part of this provider.
    if (opened.error?.type === 'not_found' || closed.error?.type === 'not_found') {
      return { skipped: true }
    }
    const error = opened.error ?? closed.error
    if (error) {
      return { error: repoError(error) }
    }
    const repoHostId = getRepoExecutionHostId(repo)
    const issues = [
      ...opened.items,
      ...closed.items.filter((issue) => isWithinDoneWindow(issue.updatedAt ?? '', now))
    ]
    return {
      cards: issues.map((issue) => {
        // The issue URL pins the project that owns it, whatever the checkout resolves to later.
        const projectRef = parseGitLabIssueOrMRLink(issue.url)?.slug
        const item: GitLabWorkItem = {
          id: `gitlab-issue-${repo.id}-${issue.number}`,
          type: 'issue',
          number: issue.number,
          title: issue.title,
          state: issue.state,
          url: issue.url,
          labels: issue.labels,
          updatedAt: issue.updatedAt ?? '',
          author: issue.author ?? null,
          repoId: repo.id,
          repoHostId,
          ...(projectRef ? { projectRef } : {})
        }
        return toGitLabTaskBoardCard(item, repo.displayName)
      })
    }
  }
}

/** Search sorts by creation; bounding by update keeps an old issue closed today inside the per-repo limit. */
function gitHubClosedQuery(now: Date): string {
  const since = new Date(now.getTime() - TASK_BOARD_DONE_WINDOW_DAYS * DAY_MS)
  return `assignee:@me is:issue is:closed updated:>=${since.toISOString().slice(0, 10)}`
}

function gitHubRepoReader(
  deps: TaskBoardRepoSourceDeps,
  { fresh }: TaskBoardListOptions
): RepoReader {
  return async (repo, now) => {
    const list = (query: string, limit: number) =>
      listWorkItems(
        repo.path,
        limit,
        query,
        undefined,
        repo.issueSourcePreference,
        getRepoRoutingConnectionId(repo),
        // Refresh and post-move reads skip gh's response cache.
        fresh,
        deps.getLocalGitArgs(repo)[0] ?? {}
      )
    const [open, closed] = await Promise.all([
      list('assignee:@me is:issue is:open', OPEN_LIMIT),
      list(gitHubClosedQuery(now), CLOSED_LIMIT)
    ])
    if (open.sources.ineligible || closed.sources.ineligible) {
      return { skipped: true }
    }
    const error = open.errors?.issues ?? closed.errors?.issues
    if (error) {
      return { error: repoError(error) }
    }
    const repoHostId = getRepoExecutionHostId(repo)
    return {
      cards: [
        ...open.items,
        ...closed.items.filter((item) => isWithinDoneWindow(item.updatedAt, now))
      ]
        .filter((item) => item.type === 'issue')
        .map((item) => {
          const stamped: GitHubWorkItem = { ...item, repoId: repo.id, repoHostId }
          return toGitHubTaskBoardCard(stamped, repo.displayName)
        })
    }
  }
}

export function readGitLabTaskBoardRepos(
  repos: readonly Repo[],
  options: TaskBoardListOptions,
  deps: TaskBoardRepoSourceDeps
): Promise<TaskBoardProviderResult> {
  return readRepos('gitlab', repos, options, gitLabRepoReader(deps))
}

export function readGitHubTaskBoardRepos(
  repos: readonly Repo[],
  options: TaskBoardListOptions,
  deps: TaskBoardRepoSourceDeps
): Promise<TaskBoardProviderResult> {
  return readRepos('github', repos, options, gitHubRepoReader(deps, options))
}
