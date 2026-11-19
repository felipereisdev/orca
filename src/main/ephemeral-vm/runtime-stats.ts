import type { Store } from '../persistence/loading-store/store'
import type { EphemeralVmRecipeStats } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { runEphemeralVmRecipeStats } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-stats-step'
import { readEphemeralVmRuntimesAsync } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store-read'
import {
  isEphemeralVmEnvironmentRunning,
  type EphemeralVmRuntimeRecord
} from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type { OrcaVmRecipe } from '../../shared/workspace-setup/orca-yaml-hook-types'
import { loadHooksAsync } from '../workspace-hooks/orca-yaml-async-read'
import {
  fallbackRuntimeRecipe,
  getRecipeRepo,
  mergeRuntimeRecipe
} from '../ipc/ephemeral-vm/ephemeral-vm-recipe-context'

const STATS_TIMEOUT_MS = 5_000
// Matches the renderer's fastest refresh, so several windows share one run.
const STATS_CACHE_MS = 15_000

export type EphemeralVmRuntimeStatsTarget = {
  runtime: EphemeralVmRuntimeRecord
  repoPath: string
  recipe: OrcaVmRecipe
}

/**
 * `readEphemeralVmRuntimeStats(runtimeId)`: the runtime's stats, read at most once per 15 s and
 * once at a time per runtime. Null, never a throw, when it is not running, its recipe has no
 * `stats` step, or the step fails, times out or prints anything else.
 */
export function createEphemeralVmRuntimeStatsReader(deps: {
  resolveTarget: (runtimeId: string) => Promise<EphemeralVmRuntimeStatsTarget | null>
}): (runtimeId: string) => Promise<EphemeralVmRecipeStats | null> {
  const cache = new Map<string, { readAt: number; stats: EphemeralVmRecipeStats | null }>()
  const inFlight = new Map<string, Promise<EphemeralVmRecipeStats | null>>()

  const readOnce = async (runtimeId: string): Promise<EphemeralVmRecipeStats | null> => {
    try {
      const target = await deps.resolveTarget(runtimeId)
      if (!target) {
        return null
      }
      const { runtime, repoPath, recipe } = target
      return await runEphemeralVmRecipeStats({
        recipe,
        repoPath,
        context: {
          instanceId: runtime.id,
          recipeId: runtime.recipeId,
          projectId: runtime.projectId,
          workspaceId: runtime.workspaceId,
          workspaceName: runtime.workspaceName,
          repoPath
        },
        recipeResult: runtime.recipeResult,
        timeoutMs: STATS_TIMEOUT_MS
      })
    } catch {
      return null
    }
  }

  return (runtimeId) => {
    const now = Date.now()
    for (const [id, entry] of cache) {
      if (now - entry.readAt >= STATS_CACHE_MS) {
        cache.delete(id)
      }
    }
    const cached = cache.get(runtimeId)
    if (cached) {
      return Promise.resolve(cached.stats)
    }
    const pending = inFlight.get(runtimeId)
    if (pending) {
      return pending
    }
    const read = readOnce(runtimeId).then((stats) => {
      inFlight.delete(runtimeId)
      cache.set(runtimeId, { readAt: Date.now(), stats })
      return stats
    })
    inFlight.set(runtimeId, read)
    return read
  }
}

/** The running runtime and the recipe its lifecycle runs, resolved like getRuntimeRecipeContext
 *  but from async reads, so the main thread never blocks on the store or orca.yaml. */
export async function resolveRuntimeStatsTarget(
  store: Store,
  userDataPath: string,
  runtimeId: string
): Promise<EphemeralVmRuntimeStatsTarget | null> {
  const { runtimes } = await readEphemeralVmRuntimesAsync(userDataPath)
  const runtime = runtimes.find((entry) => entry.id === runtimeId)
  if (!runtime?.recipeResult || !isEphemeralVmEnvironmentRunning(runtime.status)) {
    return null
  }
  const repo = runtime.repoId ? getRecipeRepo(store, runtime.repoId) : null
  if (repo?.ok) {
    const hooks = await loadHooksAsync(repo.repo.path)
    const recipe = mergeRuntimeRecipe(runtime, hooks?.environmentRecipes ?? [])
    return recipe ? { runtime, repoPath: repo.repo.path, recipe } : null
  }
  if (!runtime.recipe || !runtime.repoPath) {
    return null
  }
  const hooks = await loadHooksAsync(runtime.repoPath)
  const recipe = fallbackRuntimeRecipe(runtime, hooks?.environmentRecipes ?? [])
  return recipe ? { runtime, repoPath: runtime.repoPath, recipe } : null
}
