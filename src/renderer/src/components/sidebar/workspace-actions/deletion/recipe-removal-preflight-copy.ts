import type { Translate } from '@/i18n/use-translate'
import type {
  RecipeRemovalCopyFailure,
  RecipeRemovalPreflight,
  RecipeRemovalPreflightReason
} from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

/** Why the check could not vouch for the workspace, in the UI language. */
export function recipeRemovalReasonText(
  reason: RecipeRemovalPreflightReason | undefined,
  t: Translate
): string {
  switch (reason) {
    case 'timeout':
      return t(
        'workspaceDeletion.recipeCheck.reasonTimeout',
        "The environment didn't answer in time."
      )
    case 'asleep':
      return t(
        'workspaceDeletion.recipeCheck.reasonAsleep',
        'The environment is asleep, so its work could not be checked.'
      )
    case 'git_failed':
      return t(
        'workspaceDeletion.recipeCheck.reasonGit',
        "Git couldn't be read in the environment."
      )
    case 'recordings_failed':
      return t(
        'workspaceDeletion.recipeCheck.reasonRecordings',
        "The environment's recordings couldn't be listed."
      )
    case 'unreachable':
    case undefined:
      return t(
        'workspaceDeletion.recipeCheck.reasonUnreachable',
        "The environment can't be reached."
      )
  }
}

/** Why "Copy recordings and remove" stopped; nothing was removed in any of these cases. */
export function recipeRemovalCopyErrorText(reason: RecipeRemovalCopyFailure, t: Translate): string {
  switch (reason) {
    case 'copy_failed':
      return t(
        'workspaceDeletion.recipeCheck.copyFailed',
        "A recording couldn't be copied to this Mac. Nothing was removed."
      )
    case 'timeout':
      return t(
        'workspaceDeletion.recipeCheck.copyTimeout',
        'Copying the recordings took too long. Nothing was removed.'
      )
    case 'unavailable':
      return t(
        'workspaceDeletion.recipeCheck.copyUnavailable',
        "The recordings couldn't be listed. Nothing was removed."
      )
    case 'unreachable':
      return t(
        'workspaceDeletion.recipeCheck.copyUnreachable',
        "The environment can't be reached. Nothing was removed."
      )
  }
}

/** One line per kind of work the removal would lose, only for kinds that have any. */
export function recipeRemovalLossLines(preflight: RecipeRemovalPreflight, t: Translate): string[] {
  const lines: string[] = []
  const recordings = preflight.recordingsNotCopied.length
  if (recordings > 0) {
    lines.push(
      t(
        'workspaceDeletion.recipeCheck.recordingsNotCopied',
        '{{count}} recordings not copied to this Mac',
        {
          count: recordings,
          defaultValue_one: '{{count}} recording not copied to this Mac'
        }
      )
    )
  }
  if (preflight.dirtyFiles > 0) {
    lines.push(
      t('workspaceDeletion.recipeCheck.dirtyFiles', '{{count}} files with uncommitted changes', {
        count: preflight.dirtyFiles,
        defaultValue_one: '{{count}} file with uncommitted changes'
      })
    )
  }
  if (preflight.unpushedCommits > 0) {
    lines.push(
      t('workspaceDeletion.recipeCheck.unpushedCommits', '{{count}} commits not pushed', {
        count: preflight.unpushedCommits,
        defaultValue_one: '{{count}} commit not pushed'
      })
    )
  }
  return lines
}
