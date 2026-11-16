import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import { WorktreeCreate } from '../../shared/rpc-contract/worktree-create-params'
import { getTrackedUpstreamBranch } from '../github/client/lookup/tracked-upstream-branch'
import { requireReachableGitRoute } from '../providers/execution-host-provider-dispatch'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { resolveRpcWorkspaceCreatorProvenance } from '../runtime/rpc/callers/workspace-creator-context'
import type { RpcContext } from '../runtime/rpc/core'
import { buildManagedWorktreeCreateArgs } from '../runtime/rpc/methods/workspaces/worktree-create-args'
import { resolveRuntimeLocalWorktreeCreateBranch } from '../runtime/workspaces/creation/runtime-local-worktree-create-naming'
import { getLocalProjectWorktreeGitOptions } from '../workspaces/execution-host/project-runtime-git-options'
import type { TaskStartCard } from './task-start-context'
import type { TaskStartServiceDeps } from './task-start-service'
import { taskStartWorktreeCreateFields } from './task-start-worktree-link'

/** The card's `worktree.create`: one request names both its worktree and its primary-mode branch. */
export function taskStartWorktreeCreateArgs(
  context: RpcContext,
  repo: Repo,
  card: TaskStartCard,
  baseBranch?: string
) {
  const params = WorktreeCreate.parse({
    repo: `id:${repo.id}`,
    ...taskStartWorktreeCreateFields(card),
    ...(baseBranch ? { baseBranch } : {}),
    activate: false
  })
  return buildManagedWorktreeCreateArgs(
    params,
    { creatorProvenance: resolveRpcWorkspaceCreatorProvenance(context) },
    context
  )
}

/** This host runs the repo's git itself (local or WSL); an SSH or runtime repo throws, as worktree create does. */
function assertGitServedHere(repo: Repo): void {
  requireReachableGitRoute(getRepoExecutionHostId(repo))
}

function localGitOptions(runtime: OrcaRuntimeService, repo: Repo) {
  assertGitServedHere(repo)
  return getLocalProjectWorktreeGitOptions(runtime.requireStore(), repo)
}

/** The base's remote fetch and the primary checkout's task branch, through worktree create's own git. */
export function createTaskStartBranchDeps(
  runtime: OrcaRuntimeService,
  context: RpcContext
): Pick<TaskStartServiceDeps, 'remoteBase' | 'baseUpstream' | 'fetchBase' | 'createPrimaryBranch'> {
  return {
    remoteBase: (repo, base) =>
      runtime.resolveRemoteTrackingBase(repo.path, base, localGitOptions(runtime, repo)),
    baseUpstream: async (repo, base) => {
      const upstream = await getTrackedUpstreamBranch(
        repo.path,
        base.replace(/^refs\/heads\//, ''),
        null,
        localGitOptions(runtime, repo)
      )
      return upstream
        ? {
            remote: upstream.remoteName,
            branch: upstream.branchName,
            ref: `refs/remotes/${upstream.remoteName}/${upstream.branchName}`,
            base: `${upstream.remoteName}/${upstream.branchName}`
          }
        : null
    },
    // Worktree create's exact-base refresh, forced past its 30s reuse; that freshness then keeps
    // create from fetching again.
    fetchBase: async (repo, base) => {
      const fetched = await runtime.getOrStartRemoteTrackingBaseRefresh(
        repo.path,
        base,
        localGitOptions(runtime, repo),
        true
      )
      if (!fetched.ok) {
        throw new Error(`Could not fetch ${base.base} from ${base.remote}`)
      }
    },
    createPrimaryBranch: async ({ repo, worktreeId, card, startPoint }) => {
      assertGitServedHere(repo)
      const { branchName, checkoutExistingBranch } = await resolveRuntimeLocalWorktreeCreateBranch({
        store: runtime.requireStore(),
        repo,
        request: taskStartWorktreeCreateArgs(context, repo, card, startPoint),
        baseBranch: startPoint ?? 'HEAD'
      })
      await runtime.switchRuntimeGitBranch(
        `id:${worktreeId}`,
        checkoutExistingBranch
          ? { kind: 'local', name: branchName }
          : { kind: 'new', name: branchName, ...(startPoint ? { startPoint } : {}) }
      )
    }
  }
}
