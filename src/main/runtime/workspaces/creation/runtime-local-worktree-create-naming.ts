import type { Repo } from '../../../../shared/repository/repo-types'
import { resolveLocalGitUsername } from '../../../git/repositories/git-username'
import {
  computeWorkspaceRoot,
  getWorktreePathSettings
} from '../../../ipc/worktrees/paths/worktree-logic'
import { openWorktreeCreatePathClaim } from '../../../workspaces/creation/worktree-create-in-flight'
import {
  getLocalProjectWorktreeGitOptions,
  getWorktreeMirrorDistro
} from '../../../workspaces/execution-host/project-runtime-git-options'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import { resolveRuntimeLocalWorktreeCreateCandidate } from './runtime-local-worktree-create-candidate'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'

/** The host's create settings with the request's own layout choices, and where its worktrees live. */
export function runtimeLocalWorktreeCreateSettings(
  store: RuntimeStore,
  repo: Repo,
  request: RuntimeManagedWorktreeCreateArgs
) {
  const hostSettings = store.getSettings()
  // Carry layout choice through name retirement and metadata, not just path creation.
  const settings = {
    ...hostSettings,
    nestWorkspaces: request.nestWorkspaces ?? hostSettings.nestWorkspaces,
    // Paired desktops own this toggle in their profiles, not the host's.
    refreshLocalBaseRefOnWorktreeCreate:
      request.refreshLocalBaseRefOnWorktreeCreate ??
      hostSettings.refreshLocalBaseRefOnWorktreeCreate,
    localBaseRefSuggestionDismissed:
      request.localBaseRefSuggestionDismissed ?? hostSettings.localBaseRefSuggestionDismissed
  }
  const pathSettings = getWorktreePathSettings(repo, settings, getWorktreeMirrorDistro(store, repo))
  return { settings, pathSettings, workspaceRoot: computeWorkspaceRoot(repo.path, pathSettings) }
}

/** The username a `git-username` branch prefix needs; empty when the branch name needs none. */
export function runtimeLocalWorktreeCreateUsername(
  repo: Repo,
  request: RuntimeManagedWorktreeCreateArgs,
  settings: { branchPrefix: string }
): Promise<string> {
  return !request.branchNameOverride && settings.branchPrefix === 'git-username'
    ? resolveLocalGitUsername(repo.path)
    : Promise.resolve('')
}

/** The branch this create would make (prefix, suffix on collision, or reuse), without adding a worktree. */
export async function resolveRuntimeLocalWorktreeCreateBranch(args: {
  store: RuntimeStore
  repo: Repo
  request: RuntimeManagedWorktreeCreateArgs
  baseBranch: string
}): Promise<{ branchName: string; checkoutExistingBranch: boolean }> {
  const { store, repo, request } = args
  const { settings, pathSettings, workspaceRoot } = runtimeLocalWorktreeCreateSettings(
    store,
    repo,
    request
  )
  const pathClaim = openWorktreeCreatePathClaim()
  try {
    const candidate = await resolveRuntimeLocalWorktreeCreateCandidate({
      request,
      repo,
      settings,
      worktreePathSettings: pathSettings,
      workspaceRoot,
      username: await runtimeLocalWorktreeCreateUsername(repo, request, settings),
      store,
      baseBranch: args.baseBranch,
      localWorktreeGitOptions: getLocalProjectWorktreeGitOptions(store, repo),
      pathClaim
    })
    return {
      branchName: candidate.branchName,
      checkoutExistingBranch: candidate.checkoutExistingBranch
    }
  } finally {
    pathClaim.release()
  }
}
