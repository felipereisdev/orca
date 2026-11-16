import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../execution-host/execution-host'
import {
  getProjectIdentityKey,
  hasProjectRemoteIdentity,
  isProjectRemoteIdentityPending
} from '../project/host-setup/project-host-setup-projection'
import { isGitRepoKind } from '../repository/repo-kind'
import type { Repo } from '../repository/repo-types'

// Keep unknown/offline identities eligible until probing proves no usable remote, so repos cannot vanish without explanation.
export function getTaskEligibleRepos(repos: readonly Repo[]): Repo[] {
  return repos.filter(
    (repo) =>
      isGitRepoKind(repo) &&
      (hasProjectRemoteIdentity(repo) || isProjectRemoteIdentityPending(repo))
  )
}

export function getDefaultTaskRepoSelection(repos: readonly Repo[]): Set<string> {
  const selectedByProject = new Map<string, Repo>()
  for (const repo of repos) {
    const projectKey = getTaskRepoProjectKey(repo)
    const current = selectedByProject.get(projectKey)
    if (!current || compareDefaultTaskRepoCandidate(repo, current) < 0) {
      selectedByProject.set(projectKey, repo)
    }
  }
  return new Set([...selectedByProject.values()].map((repo) => repo.id))
}

export function getTaskRepoProjectKey(repo: Repo): string {
  return getProjectIdentityKey(repo)
}

export function compareDefaultTaskRepoCandidate(a: Repo, b: Repo): number {
  // Prefer local checkout among host twins to avoid unexpected remote auth/network work on first load.
  const aLocal = getRepoExecutionHostId(a) === LOCAL_EXECUTION_HOST_ID
  const bLocal = getRepoExecutionHostId(b) === LOCAL_EXECUTION_HOST_ID
  if (aLocal !== bLocal) {
    return aLocal ? -1 : 1
  }
  return (a.addedAt ?? 0) - (b.addedAt ?? 0) || a.id.localeCompare(b.id)
}
