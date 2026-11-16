import { translate } from '@/i18n/i18n'
import type {
  TaskStartError,
  TaskStartPrimaryReason
} from '../../../../../shared/task-board/task-board-wire-types'
import type { TaskStartRole } from '../../../../../shared/task-board/task-start-settings'

function roleLabel(role: TaskStartRole): string {
  switch (role) {
    case 'orchestrator':
      return translate('taskStart.roles.orchestrator', 'Orchestrator')
    case 'planner':
      return translate('taskStart.roles.planner', 'Planner')
    case 'planReviewer':
      return translate('taskStart.roles.planReviewer', 'Plan reviewer')
    case 'implementer':
      return translate('taskStart.roles.implementer', 'Implementer')
    case 'reviewer':
      return translate('taskStart.roles.reviewer', 'Reviewer')
    case 'qa':
      return translate('taskStart.roles.qa', 'QA')
  }
}

/** The toast for a start the host refused; `repo_unresolved` and the primary confirmation open
 *  dialogs instead. `role` names the role whose agent or account refused (older hosts send none). */
export function taskStartErrorMessage(error: TaskStartError, role?: TaskStartRole): string {
  switch (error) {
    case 'already_running':
      return translate('taskStart.error.alreadyRunning', 'This task is already running.')
    case 'primary_busy':
      return translate(
        'taskStart.error.primaryBusy',
        'Another task is running in the primary checkout.'
      )
    case 'agent_unavailable':
      if (role) {
        return translate(
          'taskStart.error.roleAgentUnavailable',
          'The agent chosen for {{role}} is not available on this host.',
          { role: roleLabel(role) }
        )
      }
      return translate(
        'taskStart.error.agentUnavailable',
        "The orchestrator's agent is not available on this host."
      )
    case 'account_needs_sign_in':
      if (role) {
        return translate(
          'taskStart.error.roleAccountNeedsSignIn',
          'Sign in to the account chosen for {{role}}, then start again.',
          { role: roleLabel(role) }
        )
      }
      return translate(
        'taskStart.error.accountNeedsSignIn',
        "Sign in to the orchestrator's account, then start again."
      )
    case 'remote_account_unsupported':
      return translate(
        'taskStart.error.remoteAccountUnsupported',
        'Managed Claude accounts do not run on SSH projects. For {{role}}, choose “Claude” to use the server’s own login.',
        { role: roleLabel(role ?? 'orchestrator') }
      )
    case 'worktree_create_failed':
      return translate('taskStart.error.worktreeCreateFailed', 'Could not create the worktree.')
    case 'primary_status_failed':
      return translate(
        'taskStart.error.primaryStatusFailed',
        "Could not read the primary checkout's status."
      )
    case 'primary_branch_failed':
      return translate(
        'taskStart.error.primaryBranchFailed',
        'Could not create the task branch in the primary checkout. Check pending changes and try again.'
      )
    case 'base_update_failed':
      return translate(
        'taskStart.error.baseUpdateFailed',
        'Could not update the base branch from the remote. Check your connection and try again.'
      )
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
