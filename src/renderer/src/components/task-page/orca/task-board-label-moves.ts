import { translate } from '@/i18n/i18n'
import { gitLabApiFor } from '@/runtime/repository-gitlab/gitlab-owner-api'
import { runIssueUpdate } from '@/components/github/github-work-item-edit-mutations'
import {
  beginEdit,
  isTrackedEdit
} from '@/components/github-item-dialog/edit-item-fields/gh-edit-task-record'
import { assertTaskPageGitHubDialogStateAuthority } from '@/components/task-page/github/task-page-github-dialog-state-authority'
import {
  gitHubTaskBoardRepoArgs,
  toGitHubTaskBoardCard
} from '@/lib/work-items/task-board/adapters/github-task-board-adapter'
import {
  gitLabTaskBoardRepoSelector,
  toGitLabTaskBoardCard
} from '@/lib/work-items/task-board/adapters/gitlab-task-board-adapter'
import { findTaskBoardRepo } from '@/lib/work-items/task-board/adapters/task-board-provider-scope'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import { normalizeTaskBoardMatch } from '@/lib/work-items/task-board/task-board-columns'
import {
  resolveLabelProviderMove,
  taskBoardRepoLabels,
  type LabelProviderMove
} from '@/lib/work-items/task-board/task-board-move-targets'
import type { GitHubWorkItem } from '../../../../../shared/github/work-items/work-item-types'
import { parseGitHubItemRepository } from '../../../../../shared/github/work-items/work-item-target'
import type { TaskChange } from '@/store/github/task-records/task-change'
import { confirmedTaskBoardCard, type TaskBoardMoveTargetArgs } from './task-board-provider-moves'

type LabelMove = Extract<LabelProviderMove, { ok: true }>

function missingRepoError(card: TaskBoardCard): Error {
  return new Error(
    translate('taskBoard.repoUnavailable', 'The repository for {{id}} is no longer in Orca.', {
      id: card.displayId
    })
  )
}

function movedLabels(labels: readonly string[], move: LabelMove): string[] {
  const removed = new Set(move.removeLabels.map(normalizeTaskBoardMatch))
  const kept = labels.filter((label) => !removed.has(normalizeTaskBoardMatch(label)))
  return [...kept, ...move.addLabels]
}

async function applyGitHubLabelMove(
  card: TaskBoardCard,
  item: GitHubWorkItem,
  move: LabelMove
): Promise<TaskBoardCard> {
  const repo = findTaskBoardRepo('github', item)
  if (!repo) {
    throw missingRepoError(card)
  }
  const { repoId, path, sourceContext } = gitHubTaskBoardRepoArgs(repo)
  const issueRepo = parseGitHubItemRepository(item.url)
  const change: TaskChange = {
    ...(move.state ? { state: move.state } : {}),
    labels: Object.fromEntries([
      ...move.addLabels.map((label) => [label, true] as const),
      ...move.removeLabels.map((label) => [label, false] as const)
    ])
  }
  // Same authority as the GitHub dialog, so other Tasks views don't keep showing the old state.
  const owner = isTrackedEdit(item, sourceContext) ? beginEdit(item, sourceContext, change) : null
  try {
    await runIssueUpdate({
      repoPath: path,
      repoId,
      sourceContext,
      projectOrigin: undefined,
      issueRepo,
      number: item.number,
      updates: {
        ...(move.state ? { state: move.state } : {}),
        addLabels: move.addLabels,
        removeLabels: move.removeLabels
      }
    })
  } catch (cause) {
    owner?.(false)
    throw cause
  }
  if (!owner && move.state) {
    assertTaskPageGitHubDialogStateAuthority({
      repoId: item.repoId,
      itemId: item.id,
      state: move.state,
      sourceContext,
      ownerRepo: issueRepo
    })
  }
  const settled = (owner ?? beginEdit(item, sourceContext, change))(true)
  const confirmed: GitHubWorkItem = {
    ...settled,
    state: move.state ?? item.state,
    labels: movedLabels(item.labels, move),
    updatedAt: new Date().toISOString()
  }
  return confirmedTaskBoardCard(card, toGitHubTaskBoardCard(confirmed, card.projectLabel))
}

/** Applies a GitLab/GitHub open/closed + label move in the repo the card was read from. */
async function applyLabelMove(card: TaskBoardCard, move: LabelMove): Promise<TaskBoardCard> {
  const { source } = card
  if (source.provider === 'github') {
    return applyGitHubLabelMove(card, source.item, move)
  }
  if (source.provider !== 'gitlab') {
    return card
  }
  const repo = findTaskBoardRepo('gitlab', source.item)
  if (!repo) {
    throw missingRepoError(card)
  }
  const selector = gitLabTaskBoardRepoSelector(repo)
  const result = await gitLabApiFor(selector).updateIssue({
    ...selector,
    number: source.item.number,
    updates: {
      ...(move.state ? { state: move.state === 'open' ? 'opened' : 'closed' } : {}),
      addLabels: move.addLabels,
      removeLabels: move.removeLabels
    }
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
  const confirmed = {
    ...source.item,
    state: move.state === 'open' ? ('opened' as const) : (move.state ?? source.item.state),
    labels: movedLabels(source.item.labels, move),
    updatedAt: new Date().toISOString()
  }
  return confirmedTaskBoardCard(card, toGitLabTaskBoardCard(confirmed, card.projectLabel))
}

/** Resolves to the confirmed card, or `unchanged` for a drop on the card's own column. */
export async function moveTaskBoardCardWithLabels(
  card: TaskBoardCard,
  {
    columnId,
    columns,
    settings,
    cards
  }: TaskBoardMoveTargetArgs & { cards: readonly TaskBoardCard[] }
): Promise<TaskBoardCard | 'unchanged'> {
  const repoLabels = taskBoardRepoLabels(card, cards)
  const move = resolveLabelProviderMove(card, columnId, columns, settings, repoLabels)
  if (!move.ok) {
    if (move.reason === 'same-column') {
      return 'unchanged'
    }
    throw new Error(
      translate('taskBoard.noLabelMapping', 'Map a label to this column in Settings → Tasks')
    )
  }
  return applyLabelMove(card, move)
}
