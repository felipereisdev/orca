import type { Store } from '../persistence/loading-store/store'
import { hashOrcaHookContent } from '../../shared/hashing/orca-hook-content-hash'
import {
  ephemeralVmFailure,
  type EphemeralVmFailure
} from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-failure-copy'
import { canUseRepoWideTrust } from '../../shared/workspace-setup/hooks/orca-hook-trust-entries'
import { getVmRecipeTrustContent } from '../../shared/workspace-setup/hooks/vm-recipe-trust-content'
import type { OrcaVmRecipe } from '../../shared/workspace-setup/orca-yaml-hook-types'
import { loadHooksAsync } from '../workspace-hooks/orca-yaml-async-read'
import { combineEphemeralVmRecipes } from '../ipc/ephemeral-vm/ephemeral-vm-recipe-context'

/**
 * The recipe a provision runs, read once from orca.yaml. A repo recipe runs only when that file
 * still hashes to the vmRecipe content the user approved (create, stats and every other step), or
 * when the repo is trusted repo-wide, which approves any content. Plugin recipes carry their own
 * approval. Nothing runs on a refusal.
 */
export async function resolveApprovedProvisionRecipe(
  store: Pick<Store, 'getUI' | 'getRepos'>,
  repo: { id: string; path: string },
  /** Untrusted IPC input: only a string equal to the current content's hash approves it. */
  request: { recipeId: string; approvedRecipeHash?: unknown },
  pluginRecipes: readonly OrcaVmRecipe[]
): Promise<{ ok: true; recipe: OrcaVmRecipe } | { ok: false; failure: EphemeralVmFailure }> {
  const hooks = await loadHooksAsync(repo.path)
  const repoRecipes = hooks?.environmentRecipes ?? []
  const recipe = combineEphemeralVmRecipes(repoRecipes, pluginRecipes).find(
    (entry) => entry.id === request.recipeId
  )
  if (!recipe) {
    return {
      ok: false,
      failure: ephemeralVmFailure('recipeNotFound', { recipeId: request.recipeId })
    }
  }
  const isRepoRecipe = repoRecipes.some((entry) => entry.id === recipe.id)
  if (
    isRepoRecipe &&
    !canUseRepoWideTrust(store.getUI().trustedOrcaHooks ?? {}, store.getRepos(), repo.id) &&
    request.approvedRecipeHash !== hashOrcaHookContent(getVmRecipeTrustContent(hooks))
  ) {
    return { ok: false, failure: ephemeralVmFailure('recipe_changed_since_approval') }
  }
  return { ok: true, recipe }
}
