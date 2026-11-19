/** The whole check before removing a recipe workspace gets this long; past it the answer is `unchecked`. */
export const RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS = 10_000

/** Why a removal check could not vouch for the workspace; the UI maps each to localized copy. */
export type RecipeRemovalPreflightReason =
  | 'timeout'
  | 'unreachable'
  | 'asleep'
  | 'git_failed'
  | 'recordings_failed'

export type RecipeRemovalRecording = { id: string; path: string; bytes: number }

/** What removing a recipe workspace would lose. `unchecked` is never a clean answer. */
export type RecipeRemovalPreflight = {
  status: 'clean' | 'unsafe' | 'unchecked'
  recordingsNotCopied: RecipeRemovalRecording[]
  dirtyFiles: number
  unpushedCommits: number
  reason?: RecipeRemovalPreflightReason
}

export type RecipeRemovalCopyFailure = 'copy_failed' | 'timeout' | 'unreachable' | 'unavailable'

/** Copying pending recordings before a removal; only `ok: true` lets the removal go on. */
export type RecipeRemovalCopyResult =
  | { ok: true; copied: number }
  | { ok: false; reason: RecipeRemovalCopyFailure }

/** The recipe runtime behind the workspace, as the desktop's runtime list describes it. */
export type RecipeRemovalTarget = {
  runtimeId: string
  workspaceId: string
  environmentId: string
  /** The recipe set up a desktop, so the environment may hold recordings. */
  hasDesktop: boolean
  /** The environment is suspended; its Orca can't answer. */
  asleep: boolean
}
