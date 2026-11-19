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
  /** The owner has no Orca server to ask (an SSH-only recipe). */
  | 'no_orca_server'
  /** The host's own record of the environment could not be read. */
  | 'store_unreadable'

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

/** A check's answer as the desktop receives it: `ack` lets the destroy that follows go ahead. */
export type RecipeRemovalCheckResult = RecipeRemovalPreflight & {
  /** Single use, bound to this workspace on this host and its runtime record; expires in 2 min. */
  ack: string
}

export type RecipeRemovalCopyFailure = 'copy_failed' | 'timeout' | 'unreachable' | 'unavailable'

/**
 * Copying pending recordings before a removal. `ok: true` proves a final list found nothing pending
 * and carries a fresh ack; recordings still pending answer with what is known instead.
 */
export type RecipeRemovalCopyResult =
  | { ok: true; copied: number; ack: string }
  | { ok: false; reason: RecipeRemovalCopyFailure }
  | { ok: false; reason: 'still_pending'; preflight: RecipeRemovalCheckResult }

/** The workspace as the desktop names it: the host decides which recipe runtime owns it. */
export type RecipeRemovalTarget = { hostId: string; workspaceId: string }
