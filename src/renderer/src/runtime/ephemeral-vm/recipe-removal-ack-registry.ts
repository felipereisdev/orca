import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import type { RecipeRemovalTarget } from '../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

// Main expires an acknowledgement after 2 min; treat it as gone a little earlier here.
const FRESH_FOR_MS = 110_000

/** The acknowledgements removal checks issued, until the destroy they allow spends them. */
const acks = new Map<string, { ack: string; issuedAt: number }>()

function keyOf(hostId: string, workspaceId: string): string {
  return `${hostId}\0${workspaceId}`
}

export function rememberRecipeRemovalAck(target: RecipeRemovalTarget, ack: string): void {
  if (ack) {
    acks.set(keyOf(target.hostId, target.workspaceId), { ack, issuedAt: Date.now() })
  }
}

export function hasFreshRecipeRemovalAck(target: RecipeRemovalTarget): boolean {
  const entry = acks.get(keyOf(target.hostId, target.workspaceId))
  return entry !== undefined && Date.now() - entry.issuedAt < FRESH_FOR_MS
}

/** The hosts a recipe runtime's workspace can be named on. */
export function recipeRuntimeHostIds(runtime: {
  runtimeEnvironmentId?: string
  sshTargetId?: string
}): string[] {
  return [
    ...(runtime.runtimeEnvironmentId
      ? [toRuntimeExecutionHostId(runtime.runtimeEnvironmentId)]
      : []),
    ...(runtime.sshTargetId ? [toSshExecutionHostId(runtime.sshTargetId)] : [])
  ]
}

/**
 * Hands the destroy the ack a check issued for this workspace, once. An empty string means none:
 * main then refuses to destroy an environment that became a workspace.
 */
export function takeRecipeRemovalAck(hostIds: readonly string[], workspaceId?: string): string {
  if (!workspaceId) {
    return ''
  }
  for (const hostId of hostIds) {
    const key = keyOf(hostId, workspaceId)
    const entry = acks.get(key)
    if (entry) {
      acks.delete(key)
      return entry.ack
    }
  }
  return ''
}
