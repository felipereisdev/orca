import type { OrcaHooks } from '../orca-yaml-hook-types'

/**
 * The environment recipe content a vmRecipe trust approval covers: every parsed recipe, whole, as
 * canonical JSON (keys sorted at every level, every value JSON-encoded). No field list to keep in
 * step, so a field added later is approved too, and no two recipes share a text. The trust dialog
 * shows it and main re-hashes it.
 */
export function getVmRecipeTrustContent(yamlHooks: OrcaHooks | null): string {
  const recipes = yamlHooks?.environmentRecipes ?? []
  if (recipes.length === 0) {
    return ''
  }
  return JSON.stringify(sortKeysDeep(recipes), null, 2)
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, sortKeysDeep(entry)])
  )
}
