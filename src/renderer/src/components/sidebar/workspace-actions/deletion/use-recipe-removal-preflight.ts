import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { createNonSecureContextUuid } from '../../../../../../shared/identifiers/non-secure-context-uuid'
import {
  claimRecipeRemovalAcks,
  recipeRemovalCandidates,
  runRecipeRemovalPreflights,
  type RecipeRemovalAcks,
  type RecipeRemovalCandidate,
  type RecipeRemovalResult
} from '@/runtime/ephemeral-vm/recipe-removal-preflights'
import {
  endRecipeRemovalSession,
  handOffRecipeRemovalSession
} from '@/runtime/ephemeral-vm/recipe-removal-session-handoff'

export type RecipeRemovalCheck =
  | { kind: 'skip' }
  | { kind: 'loading' }
  | { kind: 'done'; candidates: RecipeRemovalCandidate[]; results: RecipeRemovalResult[] }

/** `stale`: the dialog closed or retargeted while the claim was out; nothing may be removed. */
export type RecipeRemovalClaimOutcome = 'claimed' | 'refused' | 'stale'

type Workspace = { id: string; hostId?: string | null; displayName: string }

/** One shown check, a session in main. A removal flow that takes it over ends it instead. */
type Session = { id: string; current: boolean; handedOff: boolean }

/**
 * Asks main what removing these workspaces would lose, once per opening (and again on `refresh`).
 * Every answer, copy and claim belongs to this check's session: a new target or closing revokes it
 * in main, unless the removal the decision started took the session over.
 */
export function useRecipeRemovalPreflight(targets: readonly Workspace[] | null): {
  check: RecipeRemovalCheck
  refresh: () => void
  claim: (acks: RecipeRemovalAcks, remove: () => void) => Promise<RecipeRemovalClaimOutcome>
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
  const ask = useEffectEvent((sessionId: string) =>
    runRecipeRemovalPreflights(candidates, sessionId)
  )
  const refresh = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!key) {
      return undefined
    }
    const shown: Session = { id: createNonSecureContextUuid(), current: true, handedOff: false }
    session.current = shown
    void ask(shown.id).then((results) => {
      if (shown.current) {
        setAnswer({ key, results })
      } else {
        // Answered after closing: acks issued since the revoke must not outlive it either.
        endRecipeRemovalSession(shown.id)
      }
    })
    return () => {
      shown.current = false
      if (!shown.handedOff) {
        endRecipeRemovalSession(shown.id)
      }
      setAnswer(null)
    }
  }, [key])

  const claim = useCallback(
    async (acks: RecipeRemovalAcks, remove: () => void): Promise<RecipeRemovalClaimOutcome> => {
      const shown = session.current
      if (!shown?.current) {
        return 'stale'
      }
      const claimed = await claimRecipeRemovalAcks(candidates, acks)
      // The dialog may have closed while main answered; its cleanup revoked the session.
      if (!shown.current) {
        return 'stale'
      }
      if (!claimed) {
        return 'refused'
      }
      shown.handedOff = handOffRecipeRemovalSession(shown.id, remove)
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
