import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  claimRecipeRemovalAcks,
  recipeRemovalCandidates,
  revokeRecipeRemovalAcks,
  runRecipeRemovalPreflights,
  type RecipeRemovalAcks,
  type RecipeRemovalCandidate,
  type RecipeRemovalResult
} from '@/runtime/ephemeral-vm/recipe-removal-preflights'

export type RecipeRemovalCheck =
  | { kind: 'skip' }
  | { kind: 'loading' }
  | { kind: 'done'; candidates: RecipeRemovalCandidate[]; results: RecipeRemovalResult[] }

/** `stale`: the dialog closed or retargeted while the claim was out; nothing may be removed. */
export type RecipeRemovalClaimOutcome = 'claimed' | 'refused' | 'stale'

type Workspace = { id: string; hostId?: string | null; displayName: string }

/** One shown check. Its acks are revoked when it ends, unless a claim already took them over. */
type Session = { current: boolean; claimed: boolean; received: RecipeRemovalResult[] }

/**
 * Asks main what removing these workspaces would lose, once per opening (and again on `refresh`).
 * The answers' acks live only while this check is shown: a new target or closing revokes them,
 * along with any claim made from them, unless that claim already handed the removal on.
 */
export function useRecipeRemovalPreflight(targets: readonly Workspace[] | null): {
  check: RecipeRemovalCheck
  refresh: () => void
  claim: (acks: RecipeRemovalAcks) => Promise<RecipeRemovalClaimOutcome>
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
  const session = useRef<Session | null>(null)
  const ask = useEffectEvent(() => runRecipeRemovalPreflights(candidates))
  const refresh = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!key) {
      return undefined
    }
    const shown: Session = { current: true, claimed: false, received: [] }
    session.current = shown
    void ask().then((results) => {
      shown.received = results
      if (shown.current) {
        setAnswer({ key, results })
      } else {
        revokeRecipeRemovalAcks(results)
      }
    })
    return () => {
      shown.current = false
      // Closing or a new check: these answers (and claims made from them) authorize nothing.
      if (!shown.claimed) {
        revokeRecipeRemovalAcks(shown.received)
      }
      setAnswer(null)
    }
  }, [key])

  const claim = useCallback(
    async (acks: RecipeRemovalAcks): Promise<RecipeRemovalClaimOutcome> => {
      const shown = session.current
      if (!shown?.current) {
        return 'stale'
      }
      const claimed = await claimRecipeRemovalAcks(candidates, acks)
      // The dialog may have closed while main answered; its cleanup revoked these claims.
      if (!shown.current) {
        return 'stale'
      }
      if (!claimed) {
        return 'refused'
      }
      shown.claimed = true
      return 'claimed'
    },
    [candidates]
  )

  if (!key) {
    return { check: { kind: 'skip' }, refresh, claim }
  }
  return {
    check:
      answer?.key === key
        ? { kind: 'done', candidates, results: answer.results }
        : { kind: 'loading' },
    refresh,
    claim
  }
}
