import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId
} from '../../shared/execution-host/execution-host'
import type { ClassifiedError } from '../../shared/errors/classified-error'
import type {
  GitLabProjectRef,
  GitLabWorkItem,
  GitLabWorkItemStatus
} from '../../shared/gitlab/gitlab-types'
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
import { getWorkItemStatuses } from '../gitlab/work-items/work-item-status'
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
    const items = [
      ...opened.items,
      ...closed.items.filter((issue) => isWithinDoneWindow(issue.updatedAt ?? '', now))
    ].map((issue): GitLabWorkItem => {
      // The issue URL pins the project that owns it, whatever the checkout resolves to later.
      const projectRef = parseGitLabIssueOrMRLink(issue.url)?.slug
      return {
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
    })
    const statusOf = await readWorkItemStatuses(repo, items, deps)
    return {
      cards: items.map((item) => toGitLabTaskBoardCard(item, repo.displayName, statusOf(item)))
    }
  }
}

function projectKey(projectRef: GitLabProjectRef): string {
  return `${projectRef.host}/${projectRef.path}`
}

/** One GraphQL read per project; a project that cannot answer keeps its cards on labels. */
async function readWorkItemStatuses(
  repo: Repo,
  items: readonly GitLabWorkItem[],
  deps: TaskBoardRepoSourceDeps
): Promise<(item: GitLabWorkItem) => GitLabWorkItemStatus | null> {
  const projects = new Map<string, { projectRef: GitLabProjectRef; iids: number[] }>()
  for (const { projectRef, number } of items) {
    if (projectRef) {
      const project = projects.get(projectKey(projectRef)) ?? { projectRef, iids: [] }
      project.iids.push(number)
      projects.set(projectKey(projectRef), project)
    }
  }
  const reads = new Map<string, Map<number, GitLabWorkItemStatus | null>>()
  await Promise.all(
    [...projects].map(async ([key, { projectRef, iids }]) => {
      const read = await getWorkItemStatuses(
        repo.path,
        projectRef,
        iids,
        getRepoRoutingConnectionId(repo),
        deps.getLocalGitArgs(repo)[0] ?? {}
      )
      // Unsupported or failed alike: the listing shows labels rather than no board.
      if (read.kind === 'statuses') {
        reads.set(key, read.statuses)
      }
    })
  )
  return (item) =>
    (item.projectRef && reads.get(projectKey(item.projectRef))?.get(item.number)) || null
}

export function readGitLabTaskBoardRepos(
  repos: readonly Repo[],
  options: TaskBoardListOptions,
  deps: TaskBoardRepoSourceDeps
): Promise<TaskBoardProviderResult> {
  return readRepos(repos, options, gitLabRepoReader(deps))
}
