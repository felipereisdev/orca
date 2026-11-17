import type { GitLabWorkItemStatus, GitLabWorkItemStatusLifecycle } from '../gitlab/gitlab-types'
import type { JiraTransition } from '../jira/jira-types'
import type { LinearWorkflowState } from '../linear/workspace-types'
import type { TaskBoardSettings } from './task-board-settings'
import type { WorkspaceStatusDefinition } from '../worktree/types'
import { jiraStatusCategory, linearStatusCategory, type TaskBoardCard } from './task-board-card'
import {
  getActiveTaskBoardRules,
  normalizeTaskBoardMatch,
  resolveCategoryColumnId,
  resolveTaskBoardColumnId
} from './task-board-columns'

export type LabelProviderMove =
  | { ok: true; state?: 'open' | 'closed'; addLabels: string[]; removeLabels: string[] }
  | { ok: false; reason: 'no-mapping' | 'same-column' }

function labelRepoId(card: TaskBoardCard): string | null {
  const { source } = card
  return source.provider === 'gitlab' || source.provider === 'github' ? source.item.repoId : null
}

/** Labels other board cards of the card's repo carry: the casing the repo already uses. */
export function taskBoardRepoLabels(
  card: TaskBoardCard,
  cards: readonly TaskBoardCard[]
): string[] {
  const repoId = labelRepoId(card)
  return cards
    .filter((other) => other.provider === card.provider && labelRepoId(other) === repoId)
    .flatMap((other) => other.labels)
}

/** `knownLabels` (see `taskBoardRepoLabels`) keeps an added label from becoming a case variant. */
export function resolveLabelProviderMove(
  card: TaskBoardCard,
  targetColumnId: string,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings,
  knownLabels: readonly string[] = []
): LabelProviderMove {
  if (resolveTaskBoardColumnId(card, columns, settings) === targetColumnId) {
    return { ok: false, reason: 'same-column' }
  }
  if (targetColumnId === resolveCategoryColumnId('done', columns, settings)) {
    return { ok: true, state: 'closed', addLabels: [], removeLabels: [] }
  }
  const reopen = card.category === 'done' ? { state: 'open' as const } : {}
  const rules = getActiveTaskBoardRules(card.provider, columns, settings)
  const matches = (label: string, match: string): boolean =>
    normalizeTaskBoardMatch(label) === normalizeTaskBoardMatch(match)
  const cardLabelsFor = (match: string): string[] =>
    card.labels.filter((label) => matches(label, match))
  const targetRule = rules.find((rule) => rule.statusId === targetColumnId)
  if (targetRule) {
    const existing = knownLabels.find((label) => matches(label, targetRule.match))
    return {
      ok: true,
      ...reopen,
      addLabels: cardLabelsFor(targetRule.match).length > 0 ? [] : [existing ?? targetRule.match],
      removeLabels: [
        ...new Set(
          rules
            .filter((rule) => rule.statusId !== targetColumnId)
            .flatMap((rule) => cardLabelsFor(rule.match))
        )
      ]
    }
  }
  if (targetColumnId === resolveCategoryColumnId('todo', columns, settings)) {
    return {
      ok: true,
      ...reopen,
      addLabels: [],
      removeLabels: [...new Set(rules.flatMap((rule) => cardLabelsFor(rule.match)))]
    }
  }
  return { ok: false, reason: 'no-mapping' }
}

/** A GitLab card with a Status moves by Status: a column some rule targets, or the todo/done fallback. */
export function canMoveByWorkItemStatus(
  targetColumnId: string,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): boolean {
  return (
    getActiveTaskBoardRules('gitlab', columns, settings).some(
      (rule) => rule.statusId === targetColumnId
    ) ||
    targetColumnId === resolveCategoryColumnId('todo', columns, settings) ||
    targetColumnId === resolveCategoryColumnId('done', columns, settings)
  )
}

/** The allowed Status that lands `card` in the target column; null when none does. */
export function selectGitLabMoveStatus(
  card: TaskBoardCard,
  lifecycle: GitLabWorkItemStatusLifecycle,
  targetColumnId: string,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): GitLabWorkItemStatus | null {
  const named = (match: string): GitLabWorkItemStatus[] =>
    lifecycle.allowedStatuses.filter(
      (status) => normalizeTaskBoardMatch(status.name) === normalizeTaskBoardMatch(match)
    )
  const candidates: { status: GitLabWorkItemStatus; closed: boolean }[] = [
    ...getActiveTaskBoardRules('gitlab', columns, settings)
      .filter((rule) => rule.statusId === targetColumnId)
      .flatMap((rule) => named(rule.match).map((status) => ({ status, closed: false }))),
    // Then the defaults GitLab itself sets on close/reopen, as the label path closes/reopens.
    ...(targetColumnId === resolveCategoryColumnId('done', columns, settings) &&
    lifecycle.defaultClosedStatus
      ? [{ status: lifecycle.defaultClosedStatus, closed: true }]
      : []),
    ...(targetColumnId === resolveCategoryColumnId('todo', columns, settings) &&
    lifecycle.defaultOpenStatus
      ? [{ status: lifecycle.defaultOpenStatus, closed: false }]
      : [])
  ]
  // Labels stay as they are, so a candidate must land the card in the column with them.
  const hit = candidates.find(
    ({ status, closed }) =>
      resolveTaskBoardColumnId(
        {
          provider: 'gitlab',
          statusName: status.name,
          category: closed ? 'done' : 'todo',
          labels: card.labels,
          workItemStatus: status
        },
        columns,
        settings
      ) === targetColumnId
  )
  return hit?.status ?? null
}

export function selectJiraMoveTransitions(
  transitions: readonly JiraTransition[],
  targetColumnId: string,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): JiraTransition[] {
  const dropTarget = settings.providers.jira.dropTargets[targetColumnId]
  return transitions.filter((transition) =>
    dropTarget
      ? normalizeTaskBoardMatch(transition.to.name) === normalizeTaskBoardMatch(dropTarget)
      : resolveTaskBoardColumnId(
          {
            provider: 'jira',
            statusName: transition.to.name,
            category: jiraStatusCategory(transition.to.categoryKey),
            labels: []
          },
          columns,
          settings
        ) === targetColumnId
  )
}

export function selectLinearMoveStates(
  states: readonly LinearWorkflowState[],
  targetColumnId: string,
  columns: readonly WorkspaceStatusDefinition[],
  settings: TaskBoardSettings
): LinearWorkflowState[] {
  const dropTarget = settings.providers.linear.dropTargets[targetColumnId]
  return states.filter((state) => {
    if (state.type === 'canceled') {
      return false
    }
    if (dropTarget) {
      return normalizeTaskBoardMatch(state.name) === normalizeTaskBoardMatch(dropTarget)
    }
    return (
      resolveTaskBoardColumnId(
        {
          provider: 'linear',
          statusName: state.name,
          category: linearStatusCategory(state.type),
          labels: []
        },
        columns,
        settings
      ) === targetColumnId
    )
  })
}
