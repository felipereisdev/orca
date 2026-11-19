import type { OrcaHooks } from '../orca-yaml-hook-types'

/**
 * The environment recipe content a vmRecipe trust approval covers, as canonical JSON: fixed key
 * order and every field JSON-encoded, so no two different recipes share a text (a newline in one
 * field can't pose as another field's start). The trust dialog shows it and main re-hashes it.
 */
export function getVmRecipeTrustContent(yamlHooks: OrcaHooks | null): string {
  const recipes = yamlHooks?.environmentRecipes ?? []
  if (recipes.length === 0) {
    return ''
  }
  return JSON.stringify(
    recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      description: recipe.description ?? null,
      checkoutMode: recipe.checkoutMode ?? null,
      create: recipe.create,
      suspend: recipe.suspend ?? null,
      resume: recipe.resume ?? null,
      stats: recipe.stats ?? null,
      destroy: recipe.destroyDisabled ? 'none' : (recipe.destroy ?? null),
      passEnv: recipe.passEnv ?? null
    })),
    null,
    2
  )
}
