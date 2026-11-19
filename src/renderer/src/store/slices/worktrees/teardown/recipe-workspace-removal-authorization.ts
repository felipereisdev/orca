import { translate } from '@/i18n/i18n'
import {
  claimRecipeWorkspaceRemoval,
  releaseRecipeWorkspaceRemoval
} from '@/runtime/ephemeral-vm/recipe-removal-preflights'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeRemovalTarget } from '../../../../../../shared/worktree/removal/removal'
import type { WorktreeSliceGet } from '../listing/worktree-slice-types'
import { findWorktreeOnConfirmedHost } from './host-qualified-worktree-removal'
import type { RemoveWorktreeOptions } from './worktree-removal-options'

export type WorktreeRemovalAuthorization = {
  /** A removal that then fails calls it, so the hold doesn't outlive it. */
  release: () => void
  /** Adds the same-row check to the removal's own ownership check, run right before the send. */
  guard: (ownership: { assertCurrent: () => void } | null | undefined) => () => void
}

function isReplaced(
  removalTarget: WorktreeRemovalTarget,
  readCurrent: () => Pick<Worktree, 'instanceId'> | null | undefined
): boolean {
  return (
    removalTarget.instanceId !== undefined && readCurrent()?.instanceId !== removalTarget.instanceId
  )
}

/** The final guard right before the destructive send, after every await (the compatibility probe). */
export function assertWorktreeRemovalTargetCurrent(
  removalTarget: WorktreeRemovalTarget,
  readCurrent: () => Pick<Worktree, 'instanceId'> | null | undefined
): void {
  if (isReplaced(removalTarget, readCurrent)) {
    throw replacedError()
  }
}

function replacedError(): Error {
  return new Error(
    translate(
      'workspaceDeletion.recipeCheck.workspaceReplaced',
      'This workspace was replaced while it was being removed. Nothing was deleted.'
    )
  )
}

/**
 * The last step before a removal deletes anything: the row must still be the workspace the user
 * chose (not a same-id replacement), and a recipe workspace's environment must be held for its
 * destroy. Throws, so nothing is deleted, when either fails or the user cancels the review.
 * Resolves the release a removal that then fails must call, so the hold doesn't outlive it.
 */
export async function authorizeWorktreeRemoval(
  get: WorktreeSliceGet,
  removalTarget: WorktreeRemovalTarget,
  /** `recipeRemovalSessionId`: the dialog session this removal took over; it adopts in it. */
  options?: Pick<RemoveWorktreeOptions, 'recipeRemovalSessionId'>
): Promise<WorktreeRemovalAuthorization> {
  const readCurrent = () =>
    findWorktreeOnConfirmedHost(get, removalTarget.id, removalTarget.executionHostId)
  const replaced = (): boolean => isReplaced(removalTarget, readCurrent)
  if (replaced()) {
    throw replacedError()
  }
  const workspace = {
    id: removalTarget.id,
    hostId: removalTarget.executionHostId,
    displayName: readCurrent()?.displayName ?? removalTarget.id
  }
  const authorized = await claimRecipeWorkspaceRemoval(
    get(),
    workspace,
    options?.recipeRemovalSessionId
  )
  if (!authorized) {
    throw new Error(
      translate(
        'workspaceDeletion.recipeCheck.removalNotAuthorized',
        'The removal was cancelled or its environment changed. Nothing was deleted.'
      )
    )
  }
  const release = (): void => releaseRecipeWorkspaceRemoval(get(), workspace)
  // The claim's await let a same-id replacement in; check again right before anything is deleted.
  if (replaced()) {
    release()
    throw replacedError()
  }
  return {
    release,
    guard: (ownership) => () => {
      ownership?.assertCurrent()
      assertWorktreeRemovalTargetCurrent(removalTarget, readCurrent)
    }
  }
}
