import type { spawn } from 'node:child_process'
import type { OrcaVmRecipe } from '../../workspace-setup/orca-yaml-hook-types'
import { parseEphemeralVmRecipeStats, type EphemeralVmRecipeResult } from './ephemeral-vm-recipes'
import type { EphemeralVmRecipeContext } from './ephemeral-vm-recipe-runner'
import { runRecipeCommand } from './ephemeral-vm-recipe-process'
import { getEphemeralVmRecipeResultSchemaVersion } from './ephemeral-vm-recipe-checkout-mode'
import { buildEphemeralVmRecipeLifecyclePayload } from './ephemeral-vm-recipe-lifecycle-payload'

// A stats object is a few dozen bytes; anything longer is not one.
const STATS_MAX_CAPTURE_BYTES = 64 * 1024

export type EphemeralVmRecipeStatsArgs = {
  recipe: OrcaVmRecipe
  repoPath: string
  context: EphemeralVmRecipeContext
  recipeResult?: EphemeralVmRecipeResult
  timeoutMs: number
  spawnCommand?: typeof spawn
}

/**
 * Runs the recipe's optional `stats` step with the lifecycle payload on stdin, like suspend and
 * resume. Null when the recipe has none, or it fails, times out or prints anything but one stats
 * object. Its output never leaves this function except as the parsed numbers.
 */
export async function runEphemeralVmRecipeStats(args: EphemeralVmRecipeStatsArgs) {
  if (!args.recipe.stats) {
    return null
  }
  const payload = buildEphemeralVmRecipeLifecyclePayload({ ...args, mode: 'stats' })
  const result = await runRecipeCommand({
    command: args.recipe.stats,
    repoPath: args.repoPath,
    context: args.context,
    mode: 'stats',
    resultSchemaVersion: getEphemeralVmRecipeResultSchemaVersion(args.recipe),
    stdin: `${JSON.stringify(payload)}\n`,
    ...(args.recipe.passEnv ? { passEnv: args.recipe.passEnv } : {}),
    maxCaptureBytes: STATS_MAX_CAPTURE_BYTES,
    timeoutMs: args.timeoutMs,
    spawnCommand: args.spawnCommand
  })
  if (result.timedOut || result.aborted || result.exitCode !== 0) {
    return null
  }
  return parseEphemeralVmRecipeStats(result.stdout)
}
