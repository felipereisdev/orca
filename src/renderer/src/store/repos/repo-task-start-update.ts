import { normalizeRepoTaskStartSettings } from '../../../../shared/task-board/task-start-settings'
import { normalizeLinearProjectReference } from '../../../../shared/linear/linear-project-reference'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { RepoUpdate } from './repo-state'

/** Keeps a valid default Linear project and drops one that does not normalize. */
export function sanitizeDefaultLinearProjectUpdate(sanitized: RepoUpdate): void {
  if (!('defaultLinearProject' in sanitized)) {
    return
  }
  const reference = normalizeLinearProjectReference(sanitized.defaultLinearProject)
  if (reference === undefined) {
    delete sanitized.defaultLinearProject
  } else {
    sanitized.defaultLinearProject = reference
  }
}

/** `null` clears the repo's task start settings; an update that normalizes to nothing is a no-op, as on the host. */
export function mergeRepoTaskStartUpdate(
  repo: Repo,
  taskStart: Repo['taskStart'] | null | undefined
): Repo {
  if (taskStart === null) {
    const { taskStart: _taskStart, ...repoWithoutTaskStart } = repo
    return repoWithoutTaskStart
  }
  const normalized = taskStart === undefined ? undefined : normalizeRepoTaskStartSettings(taskStart)
  return normalized === undefined ? repo : { ...repo, taskStart: normalized }
}
