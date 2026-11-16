import type { Repo } from '../../../../shared/repository/repo-types'
import {
  compareDefaultTaskRepoCandidate,
  getDefaultTaskRepoSelection,
  getTaskRepoProjectKey
} from '../../../../shared/task-board/task-board-repo-scope'

export type TaskProjectPickerGroup = {
  projectKey: string
  repo: Repo
  sources: Repo[]
}

export function getTaskProjectPickerGroups(
  repos: readonly Repo[],
  preferredSelection: ReadonlySet<string> = new Set()
): TaskProjectPickerGroup[] {
  const groupsByProject = new Map<string, TaskProjectPickerGroup>()
  for (const repo of repos) {
    const projectKey = getTaskRepoProjectKey(repo)
    const current = groupsByProject.get(projectKey)
    if (!current) {
      groupsByProject.set(projectKey, { projectKey, repo, sources: [repo] })
      continue
    }
    current.sources.push(repo)
    if (compareTaskProjectPickerCandidate(repo, current.repo, preferredSelection) < 0) {
      current.repo = repo
    }
  }
  return [...groupsByProject.values()].map((group) => ({
    ...group,
    sources: [...group.sources].sort(compareDefaultTaskRepoCandidate)
  }))
}

export function normalizeTaskRepoSelection(
  repos: readonly Repo[],
  selection: ReadonlySet<string>
): Set<string> {
  const selectedByProject = new Map<string, Repo>()
  const selectedIds = new Set(selection)
  for (const repo of repos) {
    if (!selectedIds.has(repo.id)) {
      continue
    }
    const projectKey = getTaskRepoProjectKey(repo)
    const current = selectedByProject.get(projectKey)
    if (!current || compareDefaultTaskRepoCandidate(repo, current) < 0) {
      selectedByProject.set(projectKey, repo)
    }
  }
  if (selectedByProject.size === 0) {
    return getDefaultTaskRepoSelection(repos)
  }
  return new Set([...selectedByProject.values()].map((repo) => repo.id))
}

function compareTaskProjectPickerCandidate(
  a: Repo,
  b: Repo,
  preferredSelection: ReadonlySet<string>
): number {
  const aPreferred = preferredSelection.has(a.id)
  const bPreferred = preferredSelection.has(b.id)
  if (aPreferred !== bPreferred) {
    return aPreferred ? -1 : 1
  }
  return compareDefaultTaskRepoCandidate(a, b)
}
