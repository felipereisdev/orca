import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { GitHubWorkItem } from '../../../../../../shared/github/work-items/work-item-types'
import { getTaskPageRepoSourceContext } from '../../task-repo-source-context'
import { openClosedStatusCategory, type TaskBoardCard } from '../task-board-card'
import {
  disconnectedTaskBoardResult,
  failedTaskBoardResult,
  isWithinDoneWindow,
  type TaskBoardProviderResult
} from '../task-board-provider-results'
import { getTaskBoardRepos, isTaskBoardProviderVisible } from './task-board-provider-scope'

const OPEN_PER_REPO_LIMIT = 50
const CLOSED_PER_REPO_LIMIT = 20
const DISPLAY_LIMIT = 200
const OPEN_QUERY = 'assignee:@me is:issue is:open'
const CLOSED_QUERY = 'assignee:@me is:issue is:closed'

export function toGitHubTaskBoardCard(item: GitHubWorkItem, repoLabel: string): TaskBoardCard {
  return {
    refKey: `github:${item.repoHostId ?? ''}:${item.repoId}:${item.number}`,
    provider: 'github',
    displayId: `#${item.number}`,
    title: item.title,
    url: item.url,
    projectLabel: repoLabel,
    statusName: item.state,
    category: openClosedStatusCategory(item.state),
    labels: item.labels,
    updatedAt: item.updatedAt,
    source: { provider: 'github', item }
  }
}

export async function listGitHubTaskBoardCards(
  signal: AbortSignal
): Promise<TaskBoardProviderResult> {
  const repos = isTaskBoardProviderVisible('github') ? getTaskBoardRepos('github') : []
  if (repos.length === 0) {
    return disconnectedTaskBoardResult('github')
  }
  try {
    const state = useAppStore.getState()
    const repoArgs = repos.map((repo) => ({
      repoId: repo.id,
      path: repo.path,
      executionHostId: repo.executionHostId,
      sourceContext: getTaskPageRepoSourceContext(repo, 'github')
    }))
    // Why: a read held by a pending source save is obsolete, not empty; re-read once it settles.
    const read = (perRepoLimit: number, query: string) =>
      state.githubSourceCollections.readCurrent(
        repos,
        () => state.fetchWorkItemsAcrossRepos(repoArgs, perRepoLimit, DISPLAY_LIMIT, query),
        signal
      )
    const [open, closed] = await Promise.all([
      read(OPEN_PER_REPO_LIMIT, OPEN_QUERY),
      read(CLOSED_PER_REPO_LIMIT, CLOSED_QUERY)
    ])
    if (!open || !closed) {
      return failedTaskBoardResult(
        'github',
        translate('taskBoard.githubDidNotSettle', 'GitHub issues did not finish loading.')
      )
    }
    if (open.githubUnavailable || (open.failedCount === repos.length && open.items.length === 0)) {
      return failedTaskBoardResult('github', undefined)
    }
    const now = new Date()
    const labels = new Map(repos.map((repo) => [repo.id, repo.displayName]))
    const cards = [
      ...open.items,
      ...closed.items.filter((item) => isWithinDoneWindow(item.updatedAt, now))
    ]
      .filter((item) => item.type === 'issue')
      .map((item) => toGitHubTaskBoardCard(item, labels.get(item.repoId) ?? item.repoId))
    return { provider: 'github', status: 'ready', cards }
  } catch (error) {
    return failedTaskBoardResult('github', error)
  }
}
