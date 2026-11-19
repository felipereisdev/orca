import type { AppState } from '@/store/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host/execution-host'
import type {
  RecipeRemovalCheckRequest,
  RecipeRemovalCheckResult,
  RecipeRemovalTarget
} from '../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { requestRecipeRemovalReview } from './recipe-removal-review'

/** A workspace (or a runtime record) a removal would destroy, as the flows name it. */
export type RecipeRemovalCandidate = {
  /** Stable for React keys and for matching answers to candidates. */
  key: string
  request: RecipeRemovalCheckRequest
  displayName: string
}

export type RecipeRemovalResult = {
  candidate: RecipeRemovalCandidate
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

export function workspaceCandidate(
  target: RecipeRemovalTarget,
  displayName: string
): RecipeRemovalCandidate {
  return { key: `${target.hostId}\0${target.workspaceId}`, request: target, displayName }
}

/**
 * The workspaces to ask main about: every one on another host, since only main knows which a
 * recipe owns (and it refuses to destroy one nobody checked). Nothing while the experiment is off.
 */
export function recipeRemovalCandidates(
  state: Pick<AppState, 'settings'>,
  workspaces: readonly { id: string; hostId?: string | null; displayName: string }[]
): RecipeRemovalCandidate[] {
  if (state.settings?.experimentalEphemeralVms !== true) {
    return []
  }
  return workspaces.flatMap((workspace) =>
    workspace.hostId && workspace.hostId !== LOCAL_EXECUTION_HOST_ID
      ? [
          workspaceCandidate(
            { hostId: workspace.hostId, workspaceId: workspace.id },
            workspace.displayName
          )
        ]
      : []
  )
}

/** Asks main about each candidate; those no recipe owns drop out of the answer. */
export async function runRecipeRemovalPreflights(
  candidates: readonly RecipeRemovalCandidate[]
): Promise<RecipeRemovalResult[]> {
  const answers = await Promise.all(
    candidates.map(async (candidate): Promise<RecipeRemovalResult | null> => {
      const preflight = await window.api.ephemeralVm
        .removalPreflight(candidate.request)
        .catch(() => BRIDGE_FAILED)
      return preflight ? { candidate, preflight } : null
    })
  )
  return answers.filter((answer): answer is RecipeRemovalResult => answer !== null)
}

/** Cancel or close: none of these answers may authorize a removal afterwards. */
export function revokeRecipeRemovalAcks(results: readonly RecipeRemovalResult[]): void {
  for (const { preflight } of results) {
    if (preflight.ack) {
      void window.api.ephemeralVm.revokeRemoval({ ack: preflight.ack }).catch(() => {})
    }
  }
}

/** The acks a decision to remove hands on, keyed by candidate. */
export type RecipeRemovalAcks = ReadonlyMap<string, string>

/**
 * Checks these candidates and, when anything isn't clean, shows the review. Resolves the acks the
 * removal may spend (clean ones as issued, the rest confirmed by "Remove anyway"), or null when the
 * user cancelled, in which case every ack was revoked.
 */
export async function reviewRecipeRemoval(
  candidates: readonly RecipeRemovalCandidate[]
): Promise<RecipeRemovalAcks | null> {
  const results = await runRecipeRemovalPreflights(candidates)
  if (results.every((result) => result.preflight.status === 'clean')) {
    return new Map(results.map((result) => [result.candidate.key, result.preflight.ack]))
  }
  return requestRecipeRemovalReview(results, candidates.length === 1)
}

/** A refused claim is checked and reviewed once more; past that the removal stops. */
const CLAIM_REVIEWS = 2

/**
 * Right before a removal deletes a workspace's checkout: holds the workspace's environment for its
 * destroy. Uses an authorization a decision already claimed; otherwise checks again and reviews
 * unless the answer is clean, and does so again when main refuses that claim (the answer expired or
 * the environment changed). False when the user cancelled or main kept refusing.
 */
export async function claimRecipeWorkspaceRemoval(
  state: Pick<AppState, 'settings'>,
  workspace: { id: string; hostId?: string | null; displayName: string }
): Promise<boolean> {
  const [candidate] = recipeRemovalCandidates(state, [workspace])
  if (!candidate || !('hostId' in candidate.request)) {
    return true
  }
  const target = candidate.request
  const held = await window.api.ephemeralVm.claimRemoval({ ...target, ack: '' })
  if (held.ok) {
    return true
  }
  for (let review = 0; review < CLAIM_REVIEWS; review += 1) {
    const acks = await reviewRecipeRemoval([candidate])
    if (!acks) {
      return false
    }
    const claimed = await window.api.ephemeralVm.claimRemoval({
      ...target,
      ack: acks.get(candidate.key) ?? ''
    })
    if (claimed.ok) {
      return true
    }
  }
  return false
}

/** The removal failed after its claim: main stops holding the environment for a destroy. */
export function releaseRecipeWorkspaceRemoval(
  state: Pick<AppState, 'settings'>,
  workspace: { id: string; hostId?: string | null; displayName: string }
): void {
  const [candidate] = recipeRemovalCandidates(state, [workspace])
  if (candidate && 'hostId' in candidate.request) {
    void window.api.ephemeralVm.releaseRemoval(candidate.request).catch(() => {})
  }
}

/** Claims a decision's acks right away, for removals that start as soon as the user decides. */
export async function claimRecipeRemovalAcks(
  candidates: readonly RecipeRemovalCandidate[],
  acks: RecipeRemovalAcks
): Promise<boolean> {
  const claims = await Promise.all(
    candidates.map((candidate) =>
      'hostId' in candidate.request
        ? window.api.ephemeralVm.claimRemoval({
            ...candidate.request,
            ack: acks.get(candidate.key) ?? ''
          })
        : Promise.resolve({ ok: true as const, required: false as const })
    )
  )
  return claims.every((claim) => claim.ok)
}

/**
 * For deletes that skip the confirmation: runs `remove` when every recipe workspace is clean (its
 * removal claims a fresh check), otherwise `review` so the user sees what would be lost.
 */
export async function removeUnlessRecipeWorkNeedsReview(
  state: Pick<AppState, 'settings'>,
  workspaces: readonly { id: string; hostId?: string | null; displayName: string }[],
  remove: () => void,
  review: () => void
): Promise<void> {
  const candidates = recipeRemovalCandidates(state, workspaces)
  if (candidates.length === 0) {
    remove()
    return
  }
  const results = await runRecipeRemovalPreflights(candidates)
  const clean = results.every((result) => result.preflight.status === 'clean')
  if (clean && (await claimRecipeRemovalAcks(candidates, ackMap(results)))) {
    remove()
    return
  }
  revokeRecipeRemovalAcks(results)
  review()
}

export function ackMap(results: readonly RecipeRemovalResult[]): RecipeRemovalAcks {
  return new Map(results.map((result) => [result.candidate.key, result.preflight.ack]))
}
