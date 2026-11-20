import {
  hasEphemeralVmRecipeResult,
  RollbackEphemeralVmRuntimeRecordSchema,
  type EphemeralVmProvisionedRuntimeRecord,
  type EphemeralVmRuntimeRecord
} from './ephemeral-vm-runtimes'

/** Older builds require `recipeResult` on every record, so write-ahead records live in a sidecar they never read. */
export function partitionRuntimesForRollback(runtimes: readonly EphemeralVmRuntimeRecord[]): {
  rollback: EphemeralVmRuntimeRecord[]
  writeAhead: EphemeralVmRuntimeRecord[]
} {
  const rollback: EphemeralVmRuntimeRecord[] = []
  const writeAhead: EphemeralVmRuntimeRecord[] = []
  for (const runtime of runtimes) {
    if (hasEphemeralVmRecipeResult(runtime)) {
      rollback.push(projectRuntimeForRollback(runtime))
    } else {
      writeAhead.push(runtime)
    }
  }
  return { rollback, writeAhead }
}

export function projectRuntimeForRollback(
  runtime: EphemeralVmProvisionedRuntimeRecord
): EphemeralVmRuntimeRecord {
  const recipe = runtime.recipe
    ? (({ checkoutMode: _checkoutMode, ...rollbackRecipe }) => rollbackRecipe)(runtime.recipe)
    : undefined
  // Older builds parse recipe results strictly and know neither `checkoutMode` nor `desktop`.
  const { desktop: _desktop, ...withoutDesktop } = runtime.recipeResult
  const recipeResult =
    withoutDesktop.schemaVersion === 2
      ? (({ checkoutMode: _checkoutMode, ...rollbackResult }) => ({
          ...rollbackResult,
          schemaVersion: 1 as const
        }))(withoutDesktop)
      : withoutDesktop
  return RollbackEphemeralVmRuntimeRecordSchema.parse({
    ...runtime,
    ...(recipe ? { recipe } : {}),
    recipeResult
  })
}

export function runtimeFeatureListsEqual<
  T extends { id: string; recipeId: string; createdAt: number }
>(left: readonly T[], right: readonly T[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
