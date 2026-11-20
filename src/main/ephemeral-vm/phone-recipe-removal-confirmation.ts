import { RecipeWorkspaceRemovalError } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-host-removal'
import type { RecipeRemovalTarget } from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import type { DesktopSettingsSource } from './desktop-configure'
import { checkRecipeRemoval } from './workspace-removal-preflight-wiring'
import { claimRecipeRemoval } from './recipe-removal-ack-handlers'

/**
 * A phone's delete sheet can't show what a removal would lose, so it may only remove a recipe
 * workspace the check finds clean; anything else is refused with what to do instead.
 */
export async function confirmPhoneRecipeRemoval(
  store: DesktopSettingsSource,
  userDataPath: string,
  target: RecipeRemovalTarget
): Promise<string> {
  const result = await checkRecipeRemoval(store, userDataPath, target)
  if (!result) {
    // Not a recipe workspace on this host, or the experiment is off: the destroy needs no ack.
    return ''
  }
  if (result.status === 'clean') {
    // Held for the whole removal: deleting the checkout and polling it can outlast the check.
    const claim = await claimRecipeRemoval(store, userDataPath, { ack: result.ack, ...target })
    if (claim.ok) {
      return result.ack
    }
  }
  throw new RecipeWorkspaceRemovalError(
    'recipe_removal_unconfirmed',
    result.status === 'unsafe'
      ? `This workspace has work that is not safe yet (${result.recordingsNotCopied.length} recordings not copied, ${result.dirtyFiles} changed files, ${result.unpushedCommits} unpushed commits). Open Orca on the Mac to review it and remove it there.`
      : "Orca couldn't verify this workspace before removing it. Open Orca on the Mac to review it and remove it there."
  )
}
