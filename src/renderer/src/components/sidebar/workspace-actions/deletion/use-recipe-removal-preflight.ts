import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import {
  recipeRemovalCandidates,
  runRecipeRemovalPreflights,
  type RecipeRemovalCandidate,
  type RecipeRemovalResult
} from './recipe-removal-preflights'

export type RecipeRemovalCheck =
  | { kind: 'skip' }
  | { kind: 'loading' }
  | { kind: 'done'; results: RecipeRemovalResult[] }

/**
 * Asks the host what removing these workspaces would lose, once per opening. With no recipe
 * workspace among them, or the experiment off, the check is skipped and the dialog stays as today.
 */
export function useRecipeRemovalPreflight(
  targets: readonly RecipeRemovalCandidate[] | null,
  checkAll = false
): RecipeRemovalCheck {
  const settings = useAppStore((s) => s.settings)
  const runtimes = useAppStore((s) => s.ephemeralVmRuntimesByWorkspaceId)
  const candidates = useMemo(
    () =>
      targets
        ? recipeRemovalCandidates(
            { settings, ephemeralVmRuntimesByWorkspaceId: runtimes },
            targets,
            checkAll
          )
        : [],
    [checkAll, runtimes, settings, targets]
  )
  // Runtime list refreshes rebuild the array; only a different set of workspaces asks again.
  const key = candidates.map((candidate) => `${candidate.hostId}\0${candidate.id}`).join('\n')
  const [answer, setAnswer] = useState<{ key: string; results: RecipeRemovalResult[] } | null>(null)
  const ask = useEffectEvent(() => runRecipeRemovalPreflights(candidates))

  useEffect(() => {
    if (!key) {
      return undefined
    }
    let current = true
    void ask().then((results) => {
      if (current) {
        setAnswer({ key, results })
      }
    })
    return () => {
      current = false
      // A later opening asks again instead of showing this answer.
      setAnswer(null)
    }
  }, [key])

  if (!key) {
    return { kind: 'skip' }
  }
  return answer?.key === key ? { kind: 'done', results: answer.results } : { kind: 'loading' }
}
