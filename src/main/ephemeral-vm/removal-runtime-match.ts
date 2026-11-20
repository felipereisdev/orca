import { z } from 'zod'
import {
  isRuntimeOwnedSshTargetId,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../shared/execution-host/execution-host'
import { readEphemeralVmRuntimesAsync } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store-read'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'

/** What a removal names; main picks the runtime records it destroys from its own store. */
export const EphemeralVmRemovalRuntimeFilter = z.object({
  workspaceIds: z.array(z.string()).optional(),
  /** Workspace owners whose same-id siblings on other hosts must survive. */
  hostScopedWorkspaces: z
    .array(z.object({ workspaceId: z.string(), executionHostId: z.string() }))
    .optional(),
  /** Runtimes pinned to these SSH targets, even without a matching workspace. */
  runtimeOwnedSshTargetIds: z.array(z.string()).optional()
})

export type EphemeralVmRemovalRuntimeFilter = z.infer<typeof EphemeralVmRemovalRuntimeFilter>

function hostScopedKey(hostId: string, workspaceId: string): string {
  return `${hostId}\0${workspaceId}`
}

function workspaceHostIds(runtime: EphemeralVmRuntimeRecord): string[] {
  return [
    ...(runtime.runtimeEnvironmentId
      ? [toRuntimeExecutionHostId(runtime.runtimeEnvironmentId)]
      : []),
    ...(runtime.sshTargetId ? [toSshExecutionHostId(runtime.sshTargetId)] : [])
  ]
}

/** The runtime records a workspace or project removal destroys, listed by main alone. */
export async function listRuntimesForRemoval(
  userDataPath: string,
  value: unknown
): Promise<EphemeralVmRuntimeRecord[]> {
  const filter = EphemeralVmRemovalRuntimeFilter.parse(value)
  const workspaceIds = new Set(filter.workspaceIds ?? [])
  const sshTargetIds = new Set(
    (filter.runtimeOwnedSshTargetIds ?? []).filter((id) => isRuntimeOwnedSshTargetId(id))
  )
  const hostScoped = new Set(
    (filter.hostScopedWorkspaces ?? []).map((target) =>
      hostScopedKey(target.executionHostId, target.workspaceId)
    )
  )
  const { runtimes } = await readEphemeralVmRuntimesAsync(userDataPath)
  return runtimes.filter((runtime) => {
    // A destroyed VM keeps its record only while its SSH target still needs purging.
    if (runtime.cleanupStatus === 'succeeded' && runtime.sshTargetId === undefined) {
      return false
    }
    if (runtime.sshTargetId !== undefined && sshTargetIds.has(runtime.sshTargetId)) {
      return true
    }
    const workspaceId = runtime.workspaceId
    if (workspaceId === undefined) {
      return false
    }
    return (
      workspaceIds.has(workspaceId) ||
      workspaceHostIds(runtime).some((hostId) => hostScoped.has(hostScopedKey(hostId, workspaceId)))
    )
  })
}
