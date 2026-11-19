import type { EphemeralVmRuntimeFeatureEntry } from './ephemeral-vm-runtime-feature-records'
import {
  featureEntryFromRuntime,
  featureIdentity,
  sortRuntimeFeatures
} from './ephemeral-vm-runtime-feature-store'
import type { EphemeralVmRuntimeRecord } from './ephemeral-vm-runtimes'

// The stats command approved with a recipe lives only in the feature sidecar: older builds parse the
// main and write-ahead files strictly, and recording it is best effort.

/** The sidecar entries the provisioned runtimes need: what their records derive, plus each one's
 *  approved stats command, which no record field carries. */
export function requiredRuntimeFeatures(
  runtimes: readonly EphemeralVmRuntimeRecord[],
  existing: readonly EphemeralVmRuntimeFeatureEntry[]
): EphemeralVmRuntimeFeatureEntry[] {
  const commands = new Map(
    existing.flatMap((entry) =>
      entry.recipeStats ? [[featureIdentity(entry), entry.recipeStats] as const] : []
    )
  )
  const byIdentity = new Map<string, EphemeralVmRuntimeFeatureEntry>()
  for (const runtime of runtimes) {
    const identity = featureIdentity(runtime)
    const derived = featureEntryFromRuntime(runtime)
    const recipeStats = commands.get(identity)
    const { id, recipeId, createdAt } = runtime
    if (derived || recipeStats) {
      byIdentity.set(identity, {
        ...(derived ?? { id, recipeId, createdAt }),
        ...(recipeStats ? { recipeStats } : {})
      })
    }
  }
  return sortRuntimeFeatures([...byIdentity.values()])
}

/** A stats command approved with the recipe that created a provisioned runtime, to record with it. */
export type PendingRuntimeStatsCommand = {
  runtime: Pick<EphemeralVmRuntimeRecord, 'id' | 'recipeId' | 'createdAt'>
  command: string
}

function mergeByIdentity(
  existing: readonly EphemeralVmRuntimeFeatureEntry[],
  required: readonly EphemeralVmRuntimeFeatureEntry[]
): EphemeralVmRuntimeFeatureEntry[] {
  const merged = new Map(existing.map((entry) => [featureIdentity(entry), entry]))
  for (const entry of required) {
    merged.set(featureIdentity(entry), entry)
  }
  return sortRuntimeFeatures([...merged.values()])
}

/**
 * The sidecar a store write leaves: `required` for the live runtimes, `prepared` with the stale
 * entries the first write keeps. A command for an unwritable sidecar only warns. `onlyStatsChanged` marks a write that only records a pending stats
 * command, which may fail without failing the store write: stats are best effort.
 */
export function planRuntimeFeatureWrite(
  runtimes: readonly EphemeralVmRuntimeRecord[],
  sidecar: { writable: boolean; features: readonly EphemeralVmRuntimeFeatureEntry[] },
  requested?: PendingRuntimeStatsCommand
): {
  required: EphemeralVmRuntimeFeatureEntry[]
  prepared: EphemeralVmRuntimeFeatureEntry[]
  onlyStatsChanged: boolean
} {
  const existing = sidecar.features
  if (requested && !sidecar.writable) {
    warnStatsCommandNotSaved(requested)
  }
  const pending = sidecar.writable ? requested : undefined
  const identity = pending ? featureIdentity(pending.runtime) : null
  const current = existing.find((entry) => featureIdentity(entry) === identity)
  const withPending = pending
    ? [
        ...existing.filter((entry) => featureIdentity(entry) !== identity),
        { ...(current ?? pending.runtime), recipeStats: pending.command }
      ]
    : existing
  const required = requiredRuntimeFeatures(runtimes, withPending)
  const prepared = mergeByIdentity(existing, required)
  const withoutPending = pending
    ? mergeByIdentity(existing, requiredRuntimeFeatures(runtimes, existing))
    : prepared
  return {
    required,
    prepared,
    onlyStatsChanged:
      pending !== undefined && JSON.stringify(withoutPending) === JSON.stringify(existing)
  }
}

export function pendingStatsCommand(
  runtime: PendingRuntimeStatsCommand['runtime'],
  command: string | undefined
): PendingRuntimeStatsCommand | undefined {
  return command ? { runtime, command } : undefined
}

// The command stays out of the log: it is recipe text, and the sidecar error adds nothing.
export function warnStatsCommandNotSaved(pending: PendingRuntimeStatsCommand): void {
  console.warn(
    `[ephemeral-vm] Could not save the stats step for ${pending.runtime.id}; its stats stay unavailable.`
  )
}

/**
 * The first sidecar write of a store write, when it changes anything. False when it only recorded a
 * pending stats command and failed: that warns instead of failing the store write.
 */
export function writePreparedFeatures(
  sidecar: { writable: boolean; features: readonly EphemeralVmRuntimeFeatureEntry[] },
  plan: { prepared: EphemeralVmRuntimeFeatureEntry[]; onlyStatsChanged: boolean },
  pending: PendingRuntimeStatsCommand | undefined,
  write: (features: EphemeralVmRuntimeFeatureEntry[]) => void
): boolean {
  if (!sidecar.writable || JSON.stringify(sidecar.features) === JSON.stringify(plan.prepared)) {
    return true
  }
  try {
    write(plan.prepared)
    return true
  } catch (error) {
    if (!plan.onlyStatsChanged || !pending) {
      throw error
    }
    warnStatsCommandNotSaved(pending)
    return false
  }
}
