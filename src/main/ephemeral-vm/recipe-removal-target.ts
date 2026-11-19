import { z } from 'zod'
import type { RecipeRemovalPreflightReason } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { readEphemeralVmRuntimesAsync } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store-read'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import {
  findEphemeralVmWorkspaceOwner,
  isProvisionedRootRuntime
} from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-workspace-owner'
import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../shared/execution-host/execution-host'
import { runtimeDesktop, type DesktopSettingsSource } from './desktop-configure'
import type { RecipeRemovalAckBinding } from './recipe-removal-acks'
import type { RemovalPreflightTarget } from './workspace-removal-preflight'

/** A workspace as a delete flow names it, or a runtime record as Cloud VMs and project removal do. */
export const RecipeRemovalRequest = z.union([
  z.object({ hostId: z.string().min(1), workspaceId: z.string().min(1) }),
  z.object({ runtimeId: z.string().min(1) })
])

export type ResolvedRecipeRemoval =
  | { kind: 'target'; target: RemovalPreflightTarget; binding: RecipeRemovalAckBinding }
  /** An owner exists but nothing on it can be vouched for. */
  | { kind: 'unchecked'; reason: RecipeRemovalPreflightReason; binding?: RecipeRemovalAckBinding }

function hostOf(runtime: EphemeralVmRuntimeRecord): string | null {
  if (runtime.runtimeEnvironmentId) {
    return toRuntimeExecutionHostId(runtime.runtimeEnvironmentId)
  }
  return runtime.sshTargetId ? toSshExecutionHostId(runtime.sshTargetId) : null
}

/** The record that owns the request, on exactly that host or with exactly that id. */
function findOwner(
  runtimes: readonly EphemeralVmRuntimeRecord[],
  request: z.infer<typeof RecipeRemovalRequest>
): { owner: EphemeralVmRuntimeRecord; hostId: string } | 'ambiguous' | null {
  if ('runtimeId' in request) {
    const owner = runtimes.find((runtime) => runtime.id === request.runtimeId)
    const hostId = owner ? hostOf(owner) : null
    return owner && hostId ? { owner, hostId } : null
  }
  try {
    const owner = findEphemeralVmWorkspaceOwner(runtimes, request.workspaceId, request.hostId)
    return owner ? { owner, hostId: request.hostId } : null
  } catch {
    return 'ambiguous'
  }
}

/**
 * The recipe runtime a removal would destroy, read from the host's own store without blocking the
 * main thread. Null when no recipe owns it, it never held a workspace, or the experiment is off.
 */
export async function resolveRecipeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  value: unknown
): Promise<ResolvedRecipeRemoval | null> {
  const request = RecipeRemovalRequest.safeParse(value).data
  if (store.getSettings().experimentalEphemeralVms !== true || !request) {
    return null
  }
  const { runtimes, complete } = await readEphemeralVmRuntimesAsync(userDataPath)
  const found = findOwner(
    runtimes.filter((runtime) => runtime.status !== 'cleaned'),
    request
  )
  if (found === 'ambiguous') {
    return { kind: 'unchecked', reason: 'ambiguous' }
  }
  if (!found) {
    return null
  }
  const { owner, hostId } = found
  if (!owner.workspaceId && !isProvisionedRootRuntime(owner)) {
    // Never attached to a workspace: nothing to lose, and the destroy needs no ack.
    return null
  }
  const binding = {
    hostId,
    workspaceId: owner.workspaceId ?? '',
    runtimeId: owner.id,
    runtimeCreatedAt: owner.createdAt
  }
  const workspaceId = owner.workspaceId ?? ('workspaceId' in request ? request.workspaceId : null)
  if (!workspaceId) {
    // An older provisioned root never recorded its workspace, so there is nothing to ask about.
    return { kind: 'unchecked', reason: 'workspace_unrecorded', binding }
  }
  if (!owner.runtimeEnvironmentId) {
    return { kind: 'unchecked', reason: 'no_orca_server', binding }
  }
  // Without every feature record the owner may have lost its desktop; never read that as none.
  if (!complete) {
    return { kind: 'unchecked', reason: 'store_unreadable', binding }
  }
  return {
    kind: 'target',
    binding,
    target: {
      runtimeId: owner.id,
      environmentId: owner.runtimeEnvironmentId,
      workspaceId,
      hasDesktop: runtimeDesktop(store, owner) !== null,
      asleep: owner.status === 'suspended'
    }
  }
}

/** The record still owning this workspace on this host, for a claim made right before removal. */
export async function currentRecipeOwner(
  userDataPath: string,
  hostId: string,
  workspaceId: string
): Promise<EphemeralVmRuntimeRecord | null | 'ambiguous'> {
  const { runtimes } = await readEphemeralVmRuntimesAsync(userDataPath)
  const found = findOwner(
    runtimes.filter((runtime) => runtime.status !== 'cleaned'),
    { hostId, workspaceId }
  )
  return found === 'ambiguous' ? found : (found?.owner ?? null)
}
