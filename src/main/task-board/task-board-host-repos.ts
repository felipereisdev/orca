import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import {
  getDefaultTaskRepoSelection,
  getTaskEligibleRepos
} from '../../shared/task-board/task-board-repo-scope'
import type { PreflightStatus } from '../preflight/agent-detection'

function repoHostKind(repo: Repo) {
  return parseExecutionHostId(getRepoExecutionHostId(repo))?.kind ?? null
}

function isHostExecutedRepo(repo: Repo): boolean {
  // Runtime repos belong to another Orca; SSH repos are driven from this host today.
  const kind = repoHostKind(repo)
  return kind === 'local' || kind === 'ssh'
}

/** False only when this host's preflight proves the provider CLI is missing or unknown to it. */
function hasProviderCli(provider: 'github' | 'gitlab', preflight: PreflightStatus | null): boolean {
  if (!preflight) {
    return true
  }
  if (provider === 'github') {
    return preflight.gh.installed
  }
  // Older preflight results lack glab: an unsupported host, not a missing install.
  return Object.hasOwn(preflight, 'glab') && preflight.glab?.installed === true
}

/** Host-executed, eligible, one repo per project; auth-probe failures still read (the probe misses self-hosted logins). */
export function selectTaskBoardHostRepos(
  repos: readonly Repo[],
  provider: 'github' | 'gitlab',
  preflight: PreflightStatus | null
): Repo[] {
  const eligible = getTaskEligibleRepos(repos.filter(isHostExecutedRepo))
  const selected = getDefaultTaskRepoSelection(eligible)
  return eligible.filter((repo) => {
    if (!selected.has(repo.id)) {
      return false
    }
    // The local preflight describes only this machine; SSH repos run the CLI on their remote.
    return repoHostKind(repo) !== 'local' || hasProviderCli(provider, preflight)
  })
}
