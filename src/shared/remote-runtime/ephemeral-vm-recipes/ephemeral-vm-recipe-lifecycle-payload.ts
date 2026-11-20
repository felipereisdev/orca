import type { EphemeralVmRecipeResult } from './ephemeral-vm-recipes'
import type { EphemeralVmRecipeContext } from './ephemeral-vm-recipe-runner'
import { quoteShellToken } from './ephemeral-vm-recipe-process'
import type { OrcaVmRecipe } from '../../workspace-setup/orca-yaml-hook-types'

export type EphemeralVmRecipeLifecycleMode = 'suspend' | 'resume' | 'destroy' | 'stats'

export type EphemeralVmRecipeCleanupPayload = {
  schemaVersion: 1
  mode: EphemeralVmRecipeLifecycleMode
  recipeId: string
  instanceId?: string
  projectId?: string
  workspaceId?: string
  workspaceName?: string
  recipeResult?: EphemeralVmRecipeResult
}

/** Manual cleanup only (clipboard/command): desktop credentials stay out of clipboards, history and argv. */
export function buildEphemeralVmRecipeManualCleanupPayload(args: {
  recipe: Pick<OrcaVmRecipe, 'id'>
  context: EphemeralVmRecipeContext
  recipeResult?: EphemeralVmRecipeResult
}): EphemeralVmRecipeCleanupPayload {
  const recipeResult = args.recipeResult && withoutDesktopCredentials(args.recipeResult)
  return buildEphemeralVmRecipeLifecyclePayload({ ...args, recipeResult, mode: 'destroy' })
}

function withoutDesktopCredentials(result: EphemeralVmRecipeResult): EphemeralVmRecipeResult {
  const { desktop: _desktop, ...rest } = result
  return rest
}

export function buildEphemeralVmRecipeLifecyclePayload(args: {
  mode: EphemeralVmRecipeLifecycleMode
  recipe: Pick<OrcaVmRecipe, 'id'>
  context: EphemeralVmRecipeContext
  recipeResult?: EphemeralVmRecipeResult
}): EphemeralVmRecipeCleanupPayload {
  return {
    schemaVersion: 1,
    mode: args.mode,
    recipeId: args.recipe.id,
    instanceId: args.context.instanceId,
    projectId: args.context.projectId,
    workspaceId: args.context.workspaceId,
    workspaceName: args.context.workspaceName,
    ...(args.recipeResult ? { recipeResult: args.recipeResult } : {})
  }
}

export function buildEphemeralVmRecipeCleanupCommand(args: {
  destroyCommand: string
  payload: EphemeralVmRecipeCleanupPayload
}): string {
  const payloadBase64 = Buffer.from(`${JSON.stringify(args.payload)}\n`, 'utf8').toString('base64')
  return [
    'node',
    '-e',
    quoteShellToken(
      `process.stdout.write(Buffer.from(${JSON.stringify(payloadBase64)}, 'base64').toString('utf8'))`
    ),
    '|',
    args.destroyCommand
  ].join(' ')
}
