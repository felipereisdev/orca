import {
  pickApprovedSetupHashes,
  type ApprovedSetupHashes
} from '../../../../../shared/worktree/creation/approved-setup-hashes'
import { useAppStore } from '@/store/index'
import type { WorktreeCreationRequest } from './pending-worktree-creation'
import { setupHooksCreateSource } from '../../../../../shared/worktree/setup-hooks-create-source'
import {
  ensureHooksApproved,
  readAndConfirmRuntimeIssueCommand
} from '../../../runtime/repo-hooks/ensure-hooks-confirmed'
import { confirmWorkspaceSetupDecision } from './setup/workspace-setup-trust'
import { buildTrustedComposerIssueCommand } from './composer-issue-command'
import { getInitialWorktreeCreationPhase } from './worktree-creation-flow-startup'

export async function prepareWorktreeCreationHooks(
  creationId: string,
  request: WorktreeCreationRequest
): Promise<WorktreeCreationRequest | null> {
  const preparation = request.hookPreparation
  if (!preparation) {
    return request
  }

  const trustContext = request.ephemeralVmRecipe ? 'vm' : 'workspace'
  const isCancelled = (): boolean => !useAppStore.getState().pendingWorktreeCreations[creationId]
  const confirmed = await confirmWorkspaceSetupDecision(
    useAppStore.getState,
    request.repoId,
    request.setupDecision,
    preparation.executionHostId,
    isCancelled,
    undefined,
    setupHooksCreateSource(request),
    trustContext
  )
  if (confirmed === 'cancelled') {
    return null
  }

  const { setupDecision, trustDecision } = confirmed
  let issueCommand = request.issueCommand
  if (preparation.issueCommand && preparation.executionHostId && trustDecision !== 'skip') {
    const confirmed = await readAndConfirmRuntimeIssueCommand(
      useAppStore.getState(),
      request.repoId,
      preparation.executionHostId,
      isCancelled,
      trustContext
    )
    if (isCancelled()) {
      return null
    }
    issueCommand = buildTrustedComposerIssueCommand({
      ...preparation.issueCommand,
      enabled: true,
      template: confirmed.template,
      trustDecision: confirmed.trustDecision
    })
  }

  // Main runs the recipe only while orca.yaml still hashes to what the user approved here.
  let approvedVmRecipeHash: string | undefined
  if (preparation.confirmVmRecipe) {
    const approval = await ensureHooksApproved(
      useAppStore.getState,
      request.repoId,
      'vmRecipe',
      preparation.executionHostId,
      undefined,
      isCancelled,
      undefined,
      undefined,
      trustContext
    )
    if (isCancelled()) {
      return null
    }
    if (approval.decision === 'skip') {
      useAppStore.getState().removePendingWorktreeCreation(creationId)
      return null
    }
    approvedVmRecipeHash = approval.approvedContentHash
  }

  const prepared: WorktreeCreationRequest = {
    ...request,
    hookPreparation: undefined,
    executionHostId: request.executionHostId ?? preparation.executionHostId,
    setupDecision,
    ...pickApprovedSetupHashes(confirmed),
    ...(approvedVmRecipeHash ? { approvedVmRecipeHash } : {}),
    issueCommand
  }
  useAppStore.getState().updatePendingWorktreeCreation(creationId, {
    request: prepared,
    phase: getInitialWorktreeCreationPhase(prepared)
  })
  return prepared
}

/** Setup fields for the create call; the approved hash lets the host check the created branch. */
export function setupCreateArgs(
  request: Pick<
    WorktreeCreationRequest,
    'setupOnly' | 'ephemeralVmRecipe' | keyof ApprovedSetupHashes
  >
): { setupOnly?: boolean; hookTrustContext?: 'vm' } & ApprovedSetupHashes {
  return {
    setupOnly: request.setupOnly,
    ...pickApprovedSetupHashes(request),
    ...(request.ephemeralVmRecipe ? { hookTrustContext: 'vm' as const } : {})
  }
}
