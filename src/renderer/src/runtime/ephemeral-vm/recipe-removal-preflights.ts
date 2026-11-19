import type { AppState } from '@/store/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host/execution-host'
import type {
  RecipeRemovalCheckResult,
  RecipeRemovalTarget
} from '../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { hasFreshRecipeRemovalAck, rememberRecipeRemovalAck } from './recipe-removal-ack-registry'
import { requestRecipeRemovalReview } from './recipe-removal-review'

/** A workspace about to be removed, as the delete flows hold it. */
export type RecipeRemovalCandidate = { id: string; hostId?: string | null; displayName: string }

export type RecipeRemovalResult = {
  candidate: RecipeRemovalCandidate
  target: RecipeRemovalTarget
  preflight: RecipeRemovalCheckResult
}

// The bridge failing is a check that couldn't run, never a clean answer; it has no ack either.
const BRIDGE_FAILED: RecipeRemovalCheckResult = {
  status: 'unchecked',
  recordingsNotCopied: [],
  dirtyFiles: 0,
  unpushedCommits: 0,
  reason: 'unreachable',
  ack: ''
}

type HostedCandidate = RecipeRemovalCandidate & { hostId: string }

/**
 * The workspaces to ask the host about: every one on another host, since only main knows which a
 * recipe owns (and it refuses to destroy one nobody checked). Nothing while the experiment is off.
 */
export function recipeRemovalCandidates(
  state: Pick<AppState, 'settings'>,
  candidates: readonly RecipeRemovalCandidate[]
): HostedCandidate[] {
  if (state.settings?.experimentalEphemeralVms !== true) {
    return []
  }
  return candidates.flatMap((candidate) =>
    candidate.hostId && candidate.hostId !== LOCAL_EXECUTION_HOST_ID
      ? [{ ...candidate, hostId: candidate.hostId }]
      : []
  )
}

/** Asks the host about each candidate and keeps the acks it issues for the destroys that follow. */
export async function runRecipeRemovalPreflights(
  candidates: readonly HostedCandidate[]
): Promise<RecipeRemovalResult[]> {
  const answers = await Promise.all(
    candidates.map(async (candidate): Promise<RecipeRemovalResult | null> => {
      const target = { hostId: candidate.hostId, workspaceId: candidate.id }
      const preflight = await window.api.ephemeralVm
        .removalPreflight(target)
        .catch(() => BRIDGE_FAILED)
      if (!preflight) {
        return null
      }
      rememberRecipeRemovalAck(target, preflight.ack)
      return { candidate, target, preflight }
    })
  )
  return answers.filter((answer): answer is RecipeRemovalResult => answer !== null)
}

/**
 * For removals that run without the delete dialog: checks the workspaces not yet acknowledged and,
 * when anything isn't clean, asks the user in the review dialog. True when the removal may go on.
 */
export async function confirmRecipeRemoval(
  state: Pick<AppState, 'settings'>,
  candidates: readonly RecipeRemovalCandidate[]
): Promise<boolean> {
  const asked = recipeRemovalCandidates(state, candidates).filter(
    (candidate) =>
      !hasFreshRecipeRemovalAck({ hostId: candidate.hostId, workspaceId: candidate.id })
  )
  if (asked.length === 0) {
    return true
  }
  const results = await runRecipeRemovalPreflights(asked)
  if (results.every((result) => result.preflight.status === 'clean')) {
    return true
  }
  return requestRecipeRemovalReview(results, asked.length === 1)
}

/**
 * For deletes that skip the confirmation: runs `remove` when every recipe workspace is clean,
 * otherwise `review` so the user sees what would be lost. Unchecked never counts as clean.
 */
export async function removeUnlessRecipeWorkNeedsReview(
  state: Pick<AppState, 'settings'>,
  candidates: readonly RecipeRemovalCandidate[],
  remove: () => void,
  review: () => void
): Promise<void> {
  const asked = recipeRemovalCandidates(state, candidates)
  if (asked.length === 0) {
    remove()
    return
  }
  const results = await runRecipeRemovalPreflights(asked)
  if (results.every((result) => result.preflight.status === 'clean')) {
    remove()
  } else {
    review()
  }
}
