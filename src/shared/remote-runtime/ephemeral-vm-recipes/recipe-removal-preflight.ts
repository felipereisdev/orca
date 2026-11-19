/** The whole check before removing a recipe workspace gets this long; past it the answer is `unchecked`. */
export const RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS = 10_000

/** Why a removal check could not vouch for the workspace; the UI maps each to localized copy. */
export type RecipeRemovalPreflightReason =
  | 'timeout'
  | 'unreachable'
  | 'asleep'
  | 'git_failed'
  | 'recordings_failed'
  | 'ambiguous'

export type RecipeRemovalRecording = { id: string; path: string; bytes: number }

/** What removing a recipe workspace would lose. `unchecked` is never a clean answer. */
export type RecipeRemovalPreflight = {
  status: 'clean' | 'unsafe' | 'unchecked'
  recordingsNotCopied: RecipeRemovalRecording[]
  /** Distinct paths with changes; staged and unstaged edits to one file count once. */
  dirtyFiles: number
  /** Git stopped listing changes at its limit, so `dirtyFiles` is a lower bound. */
  dirtyFilesCapped?: boolean
  unpushedCommits: number
  reason?: RecipeRemovalPreflightReason
}

export type RecipeRemovalCopyFailure = 'copy_failed' | 'timeout' | 'unreachable' | 'unavailable'

/**
 * Copying pending recordings before a removal; only `ok: true` lets the removal go on. Recordings
 * still pending after the copy passes answer with a fresh check instead.
 */
export type RecipeRemovalCopyResult =
  | { ok: true; copied: number }
  | { ok: false; reason: RecipeRemovalCopyFailure }
  | { ok: false; reason: 'still_pending'; preflight: RecipeRemovalPreflight }

/** The workspace as the desktop names it: the host decides which recipe runtime owns it. */
export type RecipeRemovalTarget = { hostId: string; workspaceId: string }
