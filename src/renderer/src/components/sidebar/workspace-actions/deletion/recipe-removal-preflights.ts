import type { AppState } from '@/store/types'
import type {
  RecipeRemovalPreflight,
  RecipeRemovalTarget
} from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

/** A workspace about to be removed, as the delete flows hold it. */
export type RecipeRemovalCandidate = { id: string; hostId?: string | null; displayName: string }

export type RecipeRemovalResult = {
  candidate: RecipeRemovalCandidate
  target: RecipeRemovalTarget
  preflight: RecipeRemovalPreflight
}

// The bridge failing is a check that couldn't run, never a clean answer.
const BRIDGE_FAILED: RecipeRemovalPreflight = {
  status: 'unchecked',
  recordingsNotCopied: [],
  dirtyFiles: 0,
  unpushedCommits: 0,
  reason: 'unreachable'
}

/**
 * The workspaces worth asking the host about. `checkAll` asks for every hosted workspace, for
 * removals already known to destroy a recipe VM; otherwise only those with a known recipe runtime.
 */
export function recipeRemovalCandidates(
  state: Pick<AppState, 'settings' | 'ephemeralVmRuntimesByWorkspaceId'>,
  candidates: readonly RecipeRemovalCandidate[],
  checkAll = false
): (RecipeRemovalCandidate & { hostId: string })[] {
  if (state.settings?.experimentalEphemeralVms !== true) {
    return []
  }
  return candidates.flatMap((candidate) =>
    candidate.hostId &&
    (checkAll || state.ephemeralVmRuntimesByWorkspaceId?.[candidate.id] !== undefined)
      ? [{ ...candidate, hostId: candidate.hostId }]
      : []
  )
}

/** Asks the host about each candidate; workspaces no recipe owns drop out of the answer. */
export async function runRecipeRemovalPreflights(
  candidates: readonly (RecipeRemovalCandidate & { hostId: string })[]
): Promise<RecipeRemovalResult[]> {
  const answers = await Promise.all(
    candidates.map(async (candidate): Promise<RecipeRemovalResult | null> => {
      const target = { hostId: candidate.hostId, workspaceId: candidate.id }
      const preflight = await window.api.ephemeralVm
        .removalPreflight(target)
        .catch(() => BRIDGE_FAILED)
      return preflight ? { candidate, target, preflight } : null
    })
  )
  return answers.filter((answer): answer is RecipeRemovalResult => answer !== null)
}

/**
 * For removals that skip the confirmation: runs `remove` when every recipe workspace is clean,
 * otherwise `review` so the user sees what would be lost. Unchecked never counts as clean.
 */
export async function removeUnlessRecipeWorkNeedsReview(
  state: Pick<AppState, 'settings' | 'ephemeralVmRuntimesByWorkspaceId'>,
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
