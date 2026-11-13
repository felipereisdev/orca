import { gitLabApiFor } from '@/runtime/repository-gitlab/gitlab-owner-api'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import type { GitLabWorkItem } from '../../../../../../shared/gitlab-types'
import { mapSettledWithConcurrency } from '../../../../../../shared/map-with-concurrency'
import type { Repo } from '../../../../../../shared/repo-types'
import { getTaskPageRepoSourceContext } from '../../task-repo-source-context'
import { openClosedStatusCategory, type TaskBoardCard } from '../task-board-card'
import {
  disconnectedTaskBoardResult,
  failedTaskBoardResult,
  isWithinDoneWindow,
  type TaskBoardProviderResult
} from '../task-board-provider-results'
import { getTaskBoardRepos } from './task-board-provider-scope'

// Leave headroom below the runtime RPC foreground concurrency of eight, as the GitLab task list does.
const GITLAB_FETCH_CONCURRENCY = 6
const OPEN_LIMIT = 50
const CLOSED_LIMIT = 20

export function toGitLabTaskBoardCard(item: GitLabWorkItem, repoLabel: string): TaskBoardCard {
  return {
    refKey: `gitlab:${item.repoHostId ?? ''}:${item.projectRef?.path ?? item.repoId}:${item.number}`,
    provider: 'gitlab',
    displayId: `#${item.number}`,
    title: item.title,
    url: item.url,
    projectLabel: repoLabel,
    statusName: item.state,
    category: openClosedStatusCategory(item.state),
    labels: item.labels,
    updatedAt: item.updatedAt,
    source: { provider: 'gitlab', item }
  }
}

type RepoIssues = { items: GitLabWorkItem[]; error?: string; notGitLab?: true }

async function listRepoIssues(repo: Repo, now: Date): Promise<RepoIssues> {
  const selector = {
    repoPath: repo.path,
    repoId: repo.id,
    sourceContext: getTaskPageRepoSourceContext(repo, 'gitlab'),
    repoOwnerExecutionHostId: getRepoExecutionHostId(repo)
  }
  const api = gitLabApiFor(selector)
  const [opened, closed] = await Promise.all([
    api.listIssues({ ...selector, state: 'opened', assignee: '@me', limit: OPEN_LIMIT }),
    api.listIssues({ ...selector, state: 'closed', assignee: '@me', limit: CLOSED_LIMIT })
  ])
  // Non-GitLab repos answer not_found; they are simply not part of this provider.
  if (opened.error?.type === 'not_found' || closed.error?.type === 'not_found') {
    return { items: [], notGitLab: true }
  }
  const error = opened.error ?? closed.error
  if (error) {
    return { items: [], error: error.message }
  }
  const repoHostId = getRepoExecutionHostId(repo)
  const items = [
    ...opened.items,
    ...closed.items.filter((item) => isWithinDoneWindow(item.updatedAt, now))
  ]
    .filter((item) => item.type === 'issue')
    .map((item) => ({ ...item, repoId: repo.id, repoHostId }))
  return { items }
}

async function readGitLabCards(signal: AbortSignal): Promise<TaskBoardProviderResult> {
  const repos = getTaskBoardRepos('gitlab')
  if (repos.length === 0) {
    return disconnectedTaskBoardResult('gitlab')
  }
  const now = new Date()
  const results = await mapSettledWithConcurrency(repos, GITLAB_FETCH_CONCURRENCY, (repo) =>
    signal.aborted ? Promise.resolve<RepoIssues>({ items: [] }) : listRepoIssues(repo, now)
  )
  const cards: TaskBoardCard[] = []
  const errors: unknown[] = []
  let loadedRepos = 0
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      errors.push(result.reason)
      return
    }
    if (result.value.error !== undefined) {
      errors.push(result.value.error)
      return
    }
    if (result.value.notGitLab) {
      return
    }
    loadedRepos += 1
    const repoLabel = repos[index].displayName
    cards.push(...result.value.items.map((item) => toGitLabTaskBoardCard(item, repoLabel)))
  })
  // A partial failure keeps the repos that loaded; only an all-failed provider shows an error.
  if (errors.length > 0 && loadedRepos === 0) {
    return failedTaskBoardResult('gitlab', errors[0])
  }
  return { provider: 'gitlab', status: 'ready', cards }
}

export async function listGitLabTaskBoardCards(
  signal: AbortSignal
): Promise<TaskBoardProviderResult> {
  try {
    return await readGitLabCards(signal)
  } catch (error) {
    return failedTaskBoardResult('gitlab', error)
  }
}
