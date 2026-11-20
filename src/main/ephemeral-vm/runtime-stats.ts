import type { Store } from '../persistence/loading-store/store'
import type { EphemeralVmRecipeStats } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { runEphemeralVmRecipeStats } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-stats-step'
import { featureIdentity } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-feature-store'
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
  runStats?: typeof runEphemeralVmRecipeStats
  /** Monotonic, so a clock change cannot keep a stale sample. */
  cacheClock?: () => number
}): (runtimeId: string) => Promise<EphemeralVmRecipeStats | null> {
  const runStats = deps.runStats ?? runEphemeralVmRecipeStats
  const cacheClock = deps.cacheClock ?? (() => performance.now())
  const cache = new Map<string, { readAt: number; stats: EphemeralVmRecipeStats | null }>()
  const inFlight = new Map<string, Promise<EphemeralVmRecipeStats | null>>()

  const readOnce = async (
    runtimeId: string,
    signal: AbortSignal
  ): Promise<EphemeralVmRecipeStats | null> => {
    // Monotonic, so a wall-clock adjustment neither skips a sample nor stretches the budget.
    const deadline = performance.now() + STATS_TIMEOUT_MS
    const target = await deps.resolveTarget(runtimeId)
    // A lookup that outlived the deadline must not launch anything: its answer is already null.
    // The clock decides, since the deadline timer may not have run yet.
    const remainingMs = deadline - performance.now()
    if (!target || signal.aborted || remainingMs <= 0) {
      return null
    }
    const { runtime, repoPath, recipe } = target
    return runStats({
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
      // The lookup spent part of the budget; the step gets what is left, and the deadline stops it.
      timeoutMs: remainingMs,
      signal
    })
  }

  // One budget for the store, orca.yaml and sidecar reads and the step itself.
  const readWithinDeadline = (runtimeId: string): Promise<EphemeralVmRecipeStats | null> =>
    new Promise((resolve) => {
      const deadline = new AbortController()
      const timer = setTimeout(() => {
        deadline.abort()
        resolve(null)
      }, STATS_TIMEOUT_MS)
      const settle = (stats: EphemeralVmRecipeStats | null): void => {
        clearTimeout(timer)
        resolve(stats)
      }
      readOnce(runtimeId, deadline.signal).then(settle, () => settle(null))
    })

  return (runtimeId) => {
    const now = cacheClock()
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
    const read = readWithinDeadline(runtimeId).then((stats) => {
      inFlight.delete(runtimeId)
      cache.set(runtimeId, { readAt: cacheClock(), stats })
      return stats
    })
    inFlight.set(runtimeId, read)
    return read
  }
}

/** The running runtime and the recipe its lifecycle runs, resolved like getRuntimeRecipeContext
 *  but from async reads, so the main thread never blocks on the store, sidecar or orca.yaml. */
export async function resolveRuntimeStatsTarget(
  store: Store,
  userDataPath: string,
  runtimeId: string
): Promise<EphemeralVmRuntimeStatsTarget | null> {
  const { runtimes, approvedStats } = await readEphemeralVmRuntimesAsync(userDataPath)
  const runtime = runtimes.find((entry) => entry.id === runtimeId)
  // Only the stats step approved with the recipe at creation may run, read from the sidecar alone
  // (its command and passEnv together); none (or an unreadable sidecar) means no stats.
  const approved = runtime ? approvedStats.get(featureIdentity(runtime)) : undefined
  if (!runtime?.recipeResult || !approved || !isEphemeralVmEnvironmentRunning(runtime.status)) {
    return null
  }
  const withApprovedStats = (recipe: OrcaVmRecipe): OrcaVmRecipe => {
    const { passEnv: _livePassEnv, ...rest } = recipe
    return {
      ...rest,
      stats: approved.command,
      ...(approved.passEnv ? { passEnv: approved.passEnv } : {})
    }
  }
  const repo = runtime.repoId ? getRecipeRepo(store, runtime.repoId) : null
  if (repo?.ok) {
    const hooks = await loadHooksAsync(repo.repo.path)
    const recipe = mergeRuntimeRecipe(runtime, hooks?.environmentRecipes ?? [])
    return recipe ? { runtime, repoPath: repo.repo.path, recipe: withApprovedStats(recipe) } : null
  }
  if (!runtime.recipe || !runtime.repoPath) {
    return null
  }
  const hooks = await loadHooksAsync(runtime.repoPath)
  const recipe = fallbackRuntimeRecipe(runtime, hooks?.environmentRecipes ?? [])
  return recipe ? { runtime, repoPath: runtime.repoPath, recipe: withApprovedStats(recipe) } : null
}
