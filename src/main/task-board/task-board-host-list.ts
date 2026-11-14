import { parseGitHubItemRepository } from '../../shared/github/work-items/work-item-target'
import type { Repo } from '../../shared/repo-types'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import {
  resolveCategoryColumnId,
  resolveTaskBoardColumnId
} from '../../shared/task-board/task-board-columns'
import { resolveLabelProviderMove } from '../../shared/task-board/task-board-move-targets'
import { taskBoardProject } from '../../shared/task-board/task-board-project-filter'
import {
  disconnectedTaskBoardResult,
  emptyTaskBoardCardsState,
  mergeTaskBoardProviderResult,
  type TaskBoardProviderResult
} from '../../shared/task-board/task-board-provider-results'
import type { TaskBoardSettings } from '../../shared/task-board/task-board-settings'
import type {
  TaskBoardCardRef,
  TaskBoardListResult,
  TaskBoardMoveTarget,
  TaskBoardWireCard
} from '../../shared/task-board/task-board-wire-types'
import type { TaskProvider } from '../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../shared/worktree/types'
import type { PreflightStatus } from '../preflight/agent-detection'
import { selectTaskBoardHostRepos } from './task-board-host-repos'
import {
  classifyTaskBoardErrorMessage,
  failedTaskBoardProvider,
  taskBoardErrorMessage
} from './task-board-provider-errors'

/** `fresh`: Refresh or post-move reads, which must bypass provider response caches. */
export type TaskBoardListOptions = { fresh: boolean; signal?: AbortSignal }

export type TaskBoardSources = {
  jira(options: TaskBoardListOptions): Promise<TaskBoardProviderResult>
  linear(options: TaskBoardListOptions): Promise<TaskBoardProviderResult>
  gitlab(repos: Repo[], options: TaskBoardListOptions): Promise<TaskBoardProviderResult>
  github(repos: Repo[], options: TaskBoardListOptions): Promise<TaskBoardProviderResult>
}

export type TaskBoardHostDeps = {
  repos(): Repo[]
  settings(): { taskBoard: TaskBoardSettings; visibleTaskProviders: TaskProvider[] }
  statuses(): WorkspaceStatusDefinition[]
  preflight(): Promise<PreflightStatus | null>
  isSshHost: boolean
  sources: TaskBoardSources
}

export function taskBoardCardRef(card: TaskBoardCard): TaskBoardCardRef {
  const { source } = card
  switch (source.provider) {
    case 'jira':
      return { provider: 'jira', siteId: source.item.siteId ?? null, key: source.item.key }
    case 'linear':
      return {
        provider: 'linear',
        workspaceId: source.item.workspaceId ?? null,
        id: source.item.id,
        teamId: source.item.team.id
      }
    case 'gitlab':
      return {
        provider: 'gitlab',
        repoId: source.item.repoId,
        number: source.item.number,
        projectRef: source.item.projectRef ?? null
      }
    case 'github': {
      // The issue URL names the repo that owns it (origin vs upstream), independent of the checkout.
      const issueRepo = parseGitHubItemRepository(source.item.url)
      return {
        provider: 'github',
        repoId: source.item.repoId,
        number: source.item.number,
        issueRepo: issueRepo ? { owner: issueRepo.owner, repo: issueRepo.repo } : null
      }
    }
  }
}

function taskBoardMoveTargets(
  card: TaskBoardCard,
  columnId: string,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): TaskBoardMoveTarget[] {
  return columns.flatMap((column): TaskBoardMoveTarget[] => {
    if (column.id === columnId) {
      return []
    }
    // Jira/Linear targets depend on the issue's live transitions, so the move itself decides.
    if (card.provider === 'jira' || card.provider === 'linear') {
      return [{ columnId: column.id, allowed: true }]
    }
    const move = resolveLabelProviderMove(card, column.id, columns, settings)
    if (move.ok) {
      return [{ columnId: column.id, allowed: true }]
    }
    return move.reason === 'no-mapping'
      ? [{ columnId: column.id, allowed: false, reason: 'no-mapping' }]
      : []
  })
}

function toWireCard(
  card: TaskBoardCard,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): TaskBoardWireCard[] {
  const columnId = resolveTaskBoardColumnId(card, columns, settings)
  if (columnId === null) {
    return []
  }
  return [
    {
      ...card,
      ref: taskBoardCardRef(card),
      columnId,
      project: taskBoardProject(card),
      moveTargets: taskBoardMoveTargets(card, columnId, columns, settings)
    }
  ]
}

async function settleProvider(
  provider: TaskProvider,
  read: () => Promise<TaskBoardProviderResult>
): Promise<TaskBoardProviderResult> {
  try {
    return await read()
  } catch (error) {
    // Sources report failures as results; this only keeps an unexpected throw from emptying the board.
    const message = taskBoardErrorMessage(error)
    return failedTaskBoardProvider(provider, {
      code: classifyTaskBoardErrorMessage(message),
      message
    })
  }
}

export async function buildTaskBoardList(
  deps: TaskBoardHostDeps,
  options: TaskBoardListOptions
): Promise<TaskBoardListResult> {
  const { taskBoard, visibleTaskProviders } = deps.settings()
  const columns = deps.statuses()
  const visible = new Set(visibleTaskProviders)
  const preflight =
    visible.has('github') || visible.has('gitlab')
      ? deps.preflight().catch(() => null)
      : Promise.resolve(null)
  const read = (
    provider: TaskProvider,
    run: () => Promise<TaskBoardProviderResult>
  ): Promise<TaskBoardProviderResult> =>
    visible.has(provider)
      ? settleProvider(provider, run)
      : Promise.resolve(disconnectedTaskBoardResult(provider))
  const readRepos = async (
    provider: 'github' | 'gitlab',
    run: (repos: Repo[]) => Promise<TaskBoardProviderResult>
  ): Promise<TaskBoardProviderResult> => {
    const repos = selectTaskBoardHostRepos(deps.repos(), provider, await preflight)
    return repos.length === 0 ? disconnectedTaskBoardResult(provider) : run(repos)
  }
  const results = await Promise.all([
    read('jira', () => deps.sources.jira(options)),
    // Linear has no SSH relay, matching Cmd-J.
    read('linear', async () =>
      deps.isSshHost ? disconnectedTaskBoardResult('linear') : deps.sources.linear(options)
    ),
    read('gitlab', () => readRepos('gitlab', (repos) => deps.sources.gitlab(repos, options))),
    read('github', () => readRepos('github', (repos) => deps.sources.github(repos, options)))
  ])
  const state = results.reduce(mergeTaskBoardProviderResult, emptyTaskBoardCardsState())
  return {
    columns,
    doneColumnId: resolveCategoryColumnId('done', columns, taskBoard) ?? taskBoard.doneStatusId,
    cards: state.cards.flatMap((card) => toWireCard(card, columns, taskBoard)),
    providers: state.providers,
    generatedAt: new Date().toISOString()
  }
}
