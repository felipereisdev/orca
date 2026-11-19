import { translate } from '@/i18n/i18n'
import { claimRecipeWorkspaceRemoval } from '@/runtime/ephemeral-vm/recipe-removal-preflights'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeRemovalTarget } from '../../../../../../shared/worktree/removal/removal'
import type { WorktreeSliceGet } from '../listing/worktree-slice-types'

/**
 * The last step before a removal deletes anything: the row must still be the workspace the user
 * chose (not a same-id replacement), and a recipe workspace's environment must be held for its
 * destroy. Throws, so nothing is deleted, when either fails or the user cancels the review.
 */
export async function authorizeWorktreeRemoval(
  get: WorktreeSliceGet,
  removalTarget: WorktreeRemovalTarget,
  current: Pick<Worktree, 'instanceId' | 'displayName'> | null | undefined
): Promise<void> {
  if (removalTarget.instanceId !== undefined && current?.instanceId !== removalTarget.instanceId) {
    throw new Error(
      translate(
        'workspaceDeletion.recipeCheck.workspaceReplaced',
        'This workspace was replaced while it was being removed. Nothing was deleted.'
      )
    )
  }
  const authorized = await claimRecipeWorkspaceRemoval(get(), {
    id: removalTarget.id,
    hostId: removalTarget.executionHostId,
    displayName: current?.displayName ?? removalTarget.id
  })
  if (!authorized) {
    throw new Error(
      translate(
        'workspaceDeletion.recipeCheck.removalNotAuthorized',
        'The removal was cancelled or its environment changed. Nothing was deleted.'
      )
    )
  }
}
