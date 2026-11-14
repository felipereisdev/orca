import { getRepoExecutionHostId, getRepoRoutingConnectionId } from '../../shared/execution-host'
import { isGitHubWorkItemsSshRemoteRequiredError } from '../../shared/github/work-items/work-item-ssh-error'
import { mapSettledWithConcurrency } from '../../shared/map-with-concurrency'
import type { Repo } from '../../shared/repo-types'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import { toGitHubTaskBoardCard } from '../../shared/task-board/task-board-provider-cards'
import {
  isWithinDoneWindow,
  type TaskBoardProviderError,
  type TaskBoardProviderResult
} from '../../shared/task-board/task-board-provider-results'
import { TASK_BOARD_DONE_WINDOW_DAYS } from '../../shared/task-board/task-board-settings'
import { sortWorkItemsByNumber } from '../../shared/work-items/work-item-order'
import { listWorkItems } from '../github/client/list/list-work-items'
import type { TaskBoardListOptions } from './task-board-host-list'
import {
  REPO_FETCH_CONCURRENCY,
  taskBoardRepoError,
  type TaskBoardRepoSourceDeps
} from './task-board-host-repo-sources'
import { classifyTaskBoardErrorMessage, taskBoardErrorMessage } from './task-board-provider-errors'

const OPEN_LIMIT = 50
const CLOSED_LIMIT = 20
// Same cap as the desktop board's cross-repo read, applied per query.
const DISPLAY_LIMIT = 200
const OPEN_QUERY = 'assignee:@me is:issue is:open'
const DAY_MS = 24 * 60 * 60 * 1000

// `number` rides along so cards sort like the desktop's cross-repo list.
type NumberedCard = { number: number; card: TaskBoardCard }
type RepoQueryRead = { skipped: true } | { cards: NumberedCard[]; error?: TaskBoardProviderError }
type QueryRead = { cards: TaskBoardCard[]; failures: TaskBoardProviderError[]; sources: number }

/** Search sorts by creation; bounding by update keeps an old issue closed today inside the per-repo limit. */
function closedQuery(now: Date): string {
  const since = new Date(now.getTime() - TASK_BOARD_DONE_WINDOW_DAYS * DAY_MS)
  return `assignee:@me is:issue is:closed updated:>=${since.toISOString().slice(0, 10)}`
}

async function readRepoQuery(
  repo: Repo,
  query: string,
  limit: number,
  { fresh }: TaskBoardListOptions,
  deps: TaskBoardRepoSourceDeps
): Promise<RepoQueryRead> {
  try {
    const result = await listWorkItems(
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
    if (result.sources.ineligible) {
      return { skipped: true }
    }
    const repoHostId = getRepoExecutionHostId(repo)
    const cards = result.items.map((item) => ({
      number: item.number,
      card: toGitHubTaskBoardCard({ ...item, repoId: repo.id, repoHostId }, repo.displayName)
    }))
    const error = result.errors?.issues
    return error ? { cards, error: taskBoardRepoError(error) } : { cards }
  } catch (error) {
    // SSH repos without a GitHub remote are not GitHub sources, as on the desktop board.
    if (isGitHubWorkItemsSshRemoteRequiredError(error)) {
      return { skipped: true }
    }
    throw error
  }
}

async function readQuery(
  repos: readonly Repo[],
  query: string,
  limit: number,
  options: TaskBoardListOptions,
  deps: TaskBoardRepoSourceDeps
): Promise<QueryRead> {
  const results = await mapSettledWithConcurrency(repos, REPO_FETCH_CONCURRENCY, (repo) =>
    options.signal?.aborted
      ? Promise.resolve<RepoQueryRead>({ skipped: true })
      : readRepoQuery(repo, query, limit, options, deps)
  )
  const read: QueryRead = { cards: [], failures: [], sources: 0 }
  const numbered: NumberedCard[] = []
  for (const result of results) {
    if (result.status === 'rejected') {
      const message = taskBoardErrorMessage(result.reason)
      read.failures.push({ code: classifyTaskBoardErrorMessage(message), message })
      read.sources += 1
    } else if ('cards' in result.value) {
      numbered.push(...result.value.cards)
      read.sources += 1
      if (result.value.error) {
        read.failures.push(result.value.error)
      }
    }
  }
  read.cards = sortWorkItemsByNumber(numbered)
    .slice(0, DISPLAY_LIMIT)
    .map(({ card }) => card)
  return read
}

/** Open and closed are read independently, so one failing never discards the other's cards. */
export async function readGitHubTaskBoardRepos(
  repos: readonly Repo[],
  options: TaskBoardListOptions,
  deps: TaskBoardRepoSourceDeps
): Promise<TaskBoardProviderResult> {
  const now = new Date()
  const [open, closed] = await Promise.all([
    readQuery(repos, OPEN_QUERY, OPEN_LIMIT, options, deps),
    readQuery(repos, closedQuery(now), CLOSED_LIMIT, options, deps)
  ])
  const cards = [
    ...open.cards,
    ...closed.cards.filter((card) => isWithinDoneWindow(card.updatedAt, now))
  ].filter((card) => card.source.provider === 'github' && card.source.item.type === 'issue')
  // A query no repo could answer is reported; failed repos beside loaded ones stay silent, as on the desktop.
  const failed = [open, closed].find(
    (read) => read.failures.length > 0 && read.failures.length === read.sources
  )
  return failed
    ? { provider: 'github', status: 'error', cards, error: failed.failures[0] }
    : { provider: 'github', status: 'ready', cards }
}
