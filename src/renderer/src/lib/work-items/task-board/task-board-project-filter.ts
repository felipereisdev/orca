import { TASK_PROVIDERS, type TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { TaskBoardCard } from './task-board-card'

export type TaskBoardProject = { key: string; provider: TaskProvider; label: string }
export type TaskBoardProjectOption = TaskBoardProject & { count: number; selected: boolean }

function projectScope(card: TaskBoardCard): string {
  const { source } = card
  switch (source.provider) {
    case 'jira':
      return `${source.item.siteId ?? ''}:${source.item.project.key}`
    case 'linear':
      return `${source.item.workspaceId ?? ''}:${source.item.project?.id ?? source.item.team.id}`
    case 'gitlab':
    case 'github':
      return `${source.item.repoHostId ?? ''}:${source.item.repoId}`
  }
}

export function taskBoardProject(card: TaskBoardCard): TaskBoardProject {
  return {
    key: `${card.provider}:${projectScope(card)}`,
    provider: card.provider,
    label: card.projectLabel
  }
}

export function listTaskBoardProjects(
  cards: readonly TaskBoardCard[],
  selected: ReadonlyMap<string, TaskBoardProject>
): TaskBoardProjectOption[] {
  const options = new Map<string, TaskBoardProjectOption>()
  for (const card of cards) {
    const project = taskBoardProject(card)
    const option = options.get(project.key)
    if (option) {
      option.count += 1
    } else {
      options.set(project.key, { ...project, count: 1, selected: selected.has(project.key) })
    }
  }
  // Why: a chosen project that empties out must stay visible so it can be unchecked.
  for (const project of selected.values()) {
    if (!options.has(project.key)) {
      options.set(project.key, { ...project, count: 0, selected: true })
    }
  }
  return [...options.values()].sort(
    (a, b) =>
      TASK_PROVIDERS.indexOf(a.provider) - TASK_PROVIDERS.indexOf(b.provider) ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key)
  )
}

export function matchesTaskBoardProjects(
  card: TaskBoardCard,
  selected: ReadonlyMap<string, TaskBoardProject>
): boolean {
  return selected.size === 0 || selected.has(taskBoardProject(card).key)
}
