import { translate } from '@/i18n/i18n'
import type {
  TaskStartError,
  TaskStartPrimaryReason
} from '../../../../../shared/task-board/task-board-wire-types'

/** The toast for a start the host refused; `repo_unresolved` and the primary confirmation open dialogs instead. */
export function taskStartErrorMessage(error: TaskStartError): string {
  switch (error) {
    case 'already_running':
      return translate('taskStart.error.alreadyRunning', 'This task is already running.')
    case 'primary_busy':
      return translate(
        'taskStart.error.primaryBusy',
        'Another task is running in the primary checkout.'
      )
    case 'agent_unavailable':
      return translate(
        'taskStart.error.agentUnavailable',
        "The orchestrator's agent is not available on this host."
      )
    case 'account_needs_sign_in':
      return translate(
        'taskStart.error.accountNeedsSignIn',
        "Sign in to the orchestrator's account, then start again."
      )
    case 'worktree_create_failed':
      return translate('taskStart.error.worktreeCreateFailed', 'Could not create the worktree.')
    case 'context_fetch_failed':
      return translate('taskStart.error.contextFetchFailed', 'Could not read the issue.')
    case 'launch_failed':
      return translate('taskStart.error.launchFailed', 'The orchestrator did not start.')
    case 'cancelled':
      return translate('taskStart.error.cancelled', 'The start was cancelled.')
    case 'repo_unresolved':
      return translate('taskStart.error.repoUnresolved', 'Choose a repository for this task.')
    case 'primary_needs_confirmation':
      return translate(
        'taskStart.error.primaryNeedsConfirmation',
        'The primary checkout needs your confirmation.'
      )
  }
}

export function taskStartPrimaryReasonMessage(reason: TaskStartPrimaryReason): string {
  switch (reason) {
    case 'uncommitted':
      return translate('taskStart.primaryReason.uncommitted', 'It has uncommitted changes.')
    case 'other-branch':
      return translate(
        'taskStart.primaryReason.otherBranch',
        'It is on a branch other than the base branch.'
      )
  }
}

export function taskStartFailureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
