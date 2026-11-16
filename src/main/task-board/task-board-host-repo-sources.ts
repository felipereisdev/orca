import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId
} from '../../shared/execution-host/execution-host'
import type { ClassifiedError } from '../../shared/errors/classified-error'
import type { GitLabWorkItem } from '../../shared/gitlab/gitlab-types'
import { mapSettledWithConcurrency } from '../../shared/concurrency/map-with-concurrency'
import { parseGitLabIssueOrMRLink } from '../../shared/new-workspace/gitlab-links'
import type { Repo } from '../../shared/repository/repo-types'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import { toGitLabTaskBoardCard } from '../../shared/task-board/task-board-provider-cards'
import {
  isWithinDoneWindow,
  type TaskBoardProviderError,
  type TaskBoardProviderResult
} from '../../shared/task-board/task-board-provider-results'
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
export const REPO_FETCH_CONCURRENCY = 6

export type TaskBoardRepoSourceDeps = {
  getLocalGitArgs(repo: Repo): [] | [LocalProjectGhExecOptions]
}

type RepoRead = { cards: TaskBoardCard[] } | { skipped: true } | { error: TaskBoardProviderError }
type RepoReader = (repo: Repo, now: Date) => Promise<RepoRead>

export function taskBoardRepoError(error: ClassifiedError): TaskBoardProviderError {
  const transport = error.type === 'network_error' || error.type === 'rate_limited'
  return {
    code: transport ? 'unavailable' : classifyTaskBoardErrorMessage(error.message),
    message: error.message
  }
}

/** A partial failure keeps the repos that loaded; only an all-failed provider reports an error. */
async function readRepos(
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
    return failedTaskBoardProvider('gitlab', errors[0])
  }
  return { provider: 'gitlab', status: 'ready', cards }
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
      return { error: taskBoardRepoError(error) }
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

export function readGitLabTaskBoardRepos(
  repos: readonly Repo[],
  options: TaskBoardListOptions,
  deps: TaskBoardRepoSourceDeps
): Promise<TaskBoardProviderResult> {
  return readRepos(repos, options, gitLabRepoReader(deps))
}
