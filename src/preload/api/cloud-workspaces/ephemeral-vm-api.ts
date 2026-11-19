import type { OrcaHooks } from '../../../shared/workspace-setup/orca-yaml-hook-types'
import type { PublicKnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { EphemeralVmRecipeDoctorResult } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import type { EphemeralVmRecipeResultWarning } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostics'
import type {
  EphemeralVmProvisionedRuntimeRecord,
  EphemeralVmRuntimeRecord,
  EphemeralVmWorkspaceLifecycleResult
} from '../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type { EphemeralVmFailure } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-failure-copy'
import type { PendingVmCheckout } from '../../../shared/remote-runtime/ephemeral-vm-store/pending-vm-checkouts'
import type {
  RecipeRemovalCheckRequest,
  RecipeRemovalCheckResult,
  RecipeRemovalClaimResult,
  RecipeRemovalCopyResult,
  RecipeRemovalTarget
} from '../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

export type EphemeralVmApi = {
  listRecipes: (args: { repoId: string }) => Promise<{
    status: 'ok' | 'error'
    repoPath: string | null
    recipes: OrcaHooks['environmentRecipes']
    diagnostics: NonNullable<OrcaHooks['environmentRecipeDiagnostics']>
    message?: string
    messageCode?: string
    messageParams?: Record<string, string | number>
  }>
  listRecipeCatalog: () => Promise<
    {
      repoId: string
      repoName: string
      repoPath: string
      recipes: NonNullable<OrcaHooks['environmentRecipes']>
      diagnostics: NonNullable<OrcaHooks['environmentRecipeDiagnostics']>
    }[]
  >
  /** Credential-like variable names (never values) recipe scripts would inherit from Orca. */
  listCredentialEnvNames: () => Promise<string[]>
  doctor: (args: { repoId: string; recipeId: string }) => Promise<EphemeralVmRecipeDoctorResult>
  provision: (args: {
    repoId: string
    recipeId: string
    workspaceName?: string
    projectId?: string
    workspaceId?: string
    branch?: string
    ref?: string
    provisionId?: string
  }) => Promise<
    | {
        ok: true
        connectionType: 'orca-server'
        runtime: EphemeralVmProvisionedRuntimeRecord
        environment: PublicKnownRuntimeEnvironment
        stderr: string
        warnings: EphemeralVmRecipeResultWarning[]
      }
    | {
        ok: true
        connectionType: 'ssh'
        runtime: EphemeralVmProvisionedRuntimeRecord
        sshTargetId: string
        /** The managed Orca server the host runs; its workspace lives there. */
        environmentId?: string
        expectedRefHead?: string
        stderr: string
        warnings: EphemeralVmRecipeResultWarning[]
      }
    | ({ ok: false; stderr: string; stdout: string } & EphemeralVmFailure)
  >
  cancelProvision: (args: { provisionId: string }) => Promise<{ cancelled: boolean }>
  onProvisionEvent: (
    callback: (event: { provisionId: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
  ) => () => void
  /** Every record, or with a filter only those a removal naming them destroys (main matches them). */
  listRuntimes: (filter?: {
    workspaceIds?: readonly string[]
    hostScopedWorkspaces?: readonly { workspaceId: string; executionHostId: string }[]
    runtimeOwnedSshTargetIds?: readonly string[]
  }) => Promise<EphemeralVmRuntimeRecord[]>
  attachWorkspace: (args: {
    runtimeId: string
    workspaceId: string
  }) => Promise<EphemeralVmRuntimeRecord>
  resumeWorkspace: (args: { workspaceId: string }) => Promise<EphemeralVmWorkspaceLifecycleResult>
  /** Suspends the workspace's VM without closing panels; sleep closes them first. */
  suspendWorkspace: (args: { workspaceId: string }) => Promise<EphemeralVmWorkspaceLifecycleResult>
  /** Fires after any runtime record write; re-list to read the new lifecycle status. */
  onRuntimesChanged: (callback: () => void) => () => void
  /**
   * Destroys the runtime's environment. `ack` is the acknowledgement its removal check issued;
   * main refuses with `recipe_removal_unconfirmed` when a workspace's environment lacks one.
   */
  cleanup: (args: { runtimeId: string; ack: string }) => Promise<EphemeralVmRuntimeRecord>
  stopCleanup: (args: { runtimeId: string }) => Promise<EphemeralVmRuntimeRecord>
  /** What removing a recipe workspace would lose; null when the check does not apply. */
  removalPreflight: (args: RecipeRemovalCheckRequest) => Promise<RecipeRemovalCheckResult | null>
  /** The user chose to remove after an unsafe or unchecked answer; false when the ack is gone. */
  confirmRemoval: (args: { ack: string }) => Promise<boolean>
  /** Cancel or close: the answer's ack, and any claim made from it, authorize nothing afterwards. */
  revokeRemoval: (args: { ack: string }) => Promise<void>
  /** Right before deleting the checkout: holds the environment for this removal's destroy. */
  claimRemoval: (args: RecipeRemovalTarget & { ack: string }) => Promise<RecipeRemovalClaimResult>
  /** The removal failed after its claim: the environment is no longer held for a destroy. */
  releaseRemoval: (args: RecipeRemovalTarget) => Promise<void>
  /** The ack a failed create's rollback needs; empty unless main knows it never held a workspace. */
  rollbackRemovalAck: (args: { runtimeId: string }) => Promise<string>
  /** Copies its pending recordings to this Mac; only `ok: true` may be followed by the removal. */
  copyRecordingsBeforeRemoval: (args: RecipeRemovalCheckRequest) => Promise<RecipeRemovalCopyResult>
  /** Drops an interrupted write-ahead record that never received a recipe result. */
  forgetRuntime: (args: { runtimeId: string }) => Promise<void>
  getCleanupCommand: (args: { runtimeId: string }) => Promise<{
    runtimeId: string
    command: string | null
    payloadJson: string
    cleanupDisabled: boolean
    message?: string
  }>
  /** This window's VM checkouts whose creates have not adopted them yet; replaces its last set. */
  publishPendingCheckouts: (checkouts: PendingVmCheckout[]) => void
  listPendingCheckouts: () => Promise<PendingVmCheckout[]>
  /** Every window's pending VM checkouts, whenever any window's set changes. */
  onPendingCheckoutsChanged: (callback: (checkouts: PendingVmCheckout[]) => void) => () => void
}
