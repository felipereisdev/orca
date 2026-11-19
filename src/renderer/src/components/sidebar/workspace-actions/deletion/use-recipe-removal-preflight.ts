import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import {
  recipeRemovalCandidates,
  revokeRecipeRemovalAcks,
  runRecipeRemovalPreflights,
  type RecipeRemovalCandidate,
  type RecipeRemovalResult
} from '@/runtime/ephemeral-vm/recipe-removal-preflights'

export type RecipeRemovalCheck =
  | { kind: 'skip' }
  | { kind: 'loading' }
  | { kind: 'done'; candidates: RecipeRemovalCandidate[]; results: RecipeRemovalResult[] }

type Workspace = { id: string; hostId?: string | null; displayName: string }

/**
 * Asks main what removing these workspaces would lose, once per opening (and again on `refresh`).
 * The answers' acks live only while this check is shown: a new target or closing revokes them.
 */
export function useRecipeRemovalPreflight(targets: readonly Workspace[] | null): {
  check: RecipeRemovalCheck
  refresh: () => void
} {
  const settings = useAppStore((s) => s.settings)
  const candidates = useMemo(
    () => (targets ? recipeRemovalCandidates({ settings }, targets) : []),
    [settings, targets]
  )
  const [generation, setGeneration] = useState(0)
  const key =
    candidates.length > 0 ? `${generation}\n${candidates.map((c) => c.key).join('\n')}` : ''
  const [answer, setAnswer] = useState<{ key: string; results: RecipeRemovalResult[] } | null>(null)
  const ask = useEffectEvent(() => runRecipeRemovalPreflights(candidates))
  const refresh = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!key) {
      return undefined
    }
    let current = true
    let received: RecipeRemovalResult[] = []
    void ask().then((results) => {
      received = results
      if (current) {
        setAnswer({ key, results })
      } else {
        revokeRecipeRemovalAcks(results)
      }
    })
    return () => {
      current = false
      // Closing or a new check: these answers authorize nothing afterwards.
      revokeRecipeRemovalAcks(received)
      setAnswer(null)
    }
  }, [key])

  if (!key) {
    return { check: { kind: 'skip' }, refresh }
  }
  return {
    check:
      answer?.key === key
        ? { kind: 'done', candidates, results: answer.results }
        : { kind: 'loading' },
    refresh
  }
}
