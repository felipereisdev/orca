import type {
  TaskStartError,
  TaskStartPrimaryReason
} from '../../../../src/shared/task-board/task-board-wire-types'
import type {
  TaskStartFailure,
  TaskStartPhase,
  TaskStartRunSummary
} from '../../../../src/shared/task-board/task-start-run'
import type { TaskStartRole } from '../../../../src/shared/task-board/task-start-settings'
import type { Translate } from '../../i18n/mobile-i18n'
import { roleLabel } from './task-start-role-choices'

// The desktop card's vocabulary (TaskBoardCardRunProgress, task-board-start-messages), in the phone's catalog.

export type RunTone = 'working' | 'attention' | 'success' | 'muted' | 'destructive'

export function taskStartRunTone(run: TaskStartRunSummary): RunTone {
  switch (run.state) {
    case 'running':
      return run.phase === 'completed' ? 'success' : 'working'
    case 'waiting':
      return 'attention'
    case 'completed':
      return 'success'
    case 'stopping':
    case 'stopped':
      return 'muted'
    case 'failed':
      return 'destructive'
  }
}

export function taskStartPhaseLabel(phase: TaskStartPhase, t: Translate): string {
  switch (phase) {
    case 'starting':
      return t('tasks.board.start.phase.starting', 'Starting')
    case 'planning':
      return t('tasks.board.start.phase.planning', 'Planning')
    case 'plan-review':
      return t('tasks.board.start.phase.planReview', 'Plan review')
    case 'qa-script':
      return t('tasks.board.start.phase.qaScript', 'QA script')
    case 'development':
      return t('tasks.board.start.phase.development', 'Development')
    case 'final-review':
      return t('tasks.board.start.phase.finalReview', 'Final review')
    case 'qa':
      return t('tasks.board.start.phase.qa', 'QA')
    case 'completed':
      return t('tasks.board.start.phase.completed', 'Completed')
  }
}

/** The state when it is not the phase's own progress: waiting, stopping, stopped or failed. */
export function taskStartSideState(run: TaskStartRunSummary, t: Translate): string | null {
  switch (run.state) {
    case 'waiting':
      return t('tasks.board.start.state.waiting', 'Waiting for you')
    case 'stopping':
      return t('tasks.board.start.state.stopping', 'Stopping…')
    case 'stopped':
      return t('tasks.board.start.state.stopped', 'Stopped')
    case 'failed':
      return t('tasks.board.start.state.failed', 'Error')
    case 'running':
    case 'completed':
      return null
  }
}

/** `n/m · implementing|reviewing` while developing; native-driven plans report no step. */
export function taskStartDevelopmentDetail(run: TaskStartRunSummary, t: Translate): string | null {
  const { progress } = run
  if (run.phase !== 'development' || !progress || !(progress.total > 0)) {
    return null
  }
  const vars = { current: progress.current, total: progress.total }
  if (progress.step === 'reviewing') {
    return t('tasks.board.start.progress.reviewing', '{{current}}/{{total}} · reviewing', vars)
  }
  if (progress.step === 'implementing') {
    return t(
      'tasks.board.start.progress.implementing',
      '{{current}}/{{total}} · implementing',
      vars
    )
  }
  return `${progress.current}/${progress.total}`
}

/** "Waiting for you · Development · 3/7 · implementing": what the card's progress row reads. */
export function taskStartStatusText(run: TaskStartRunSummary, t: Translate): string {
  const phase = taskStartPhaseLabel(run.phase, t)
  return [taskStartSideState(run, t), phase, taskStartDevelopmentDetail(run, t)]
    .filter(Boolean)
    .join(' · ')
}

function failureLabel(failure: TaskStartFailure, t: Translate): string {
  switch (failure) {
    case 'orchestrator-exited':
      return t('tasks.board.start.failure.orchestratorExited', 'The orchestrator session ended')
    case 'launch-failed':
      return t('tasks.board.start.failure.launchFailed', 'The orchestrator did not start')
    case 'context-fetch-failed':
      return t('tasks.board.start.failure.contextFetchFailed', 'Could not read the issue')
    case 'worktree-create-failed':
      return t('tasks.board.start.failure.worktreeCreateFailed', 'Could not create the worktree')
    case 'prompt-unconfirmed':
      return t('tasks.board.start.openOrchestrator', 'Open the orchestrator session')
    case 'stop-unconfirmed':
      return t('tasks.board.start.failure.stopUnconfirmed', 'Stop not confirmed. Stop again.')
    case 'cancelled':
      return t('tasks.board.start.failure.cancelled', 'Start cancelled')
  }
}

/** One muted line under the bar: the failure, the unconfirmed prompt, or the orchestrator's note. */
export function taskStartRunHint(run: TaskStartRunSummary, t: Translate): string | null {
  if (run.failure && (run.state === 'failed' || run.state === 'stopping')) {
    return failureLabel(run.failure, t)
  }
  if (run.note === 'prompt-unconfirmed') {
    return t('tasks.board.start.openOrchestrator', 'Open the orchestrator session')
  }
  if (run.note === 'stop-forced') {
    return t('tasks.board.start.stopForced', 'Run forgotten. Its agents may still be running.')
  }
  if (run.note === 'move-skipped') {
    return t(
      'tasks.board.start.moveSkipped',
      "Couldn't move the card to In progress — move it manually."
    )
  }
  return run.note ?? null
}

/** A start the host refused; `repo_unresolved` and the primary confirmation open sheets instead.
 *  `role` names the role whose agent or account refused (older hosts send none). */
export function taskStartErrorMessage(
  error: TaskStartError,
  t: Translate,
  role?: TaskStartRole
): string {
  switch (error) {
    case 'already_running':
      return t('tasks.board.start.error.alreadyRunning', 'This task is already running.')
    case 'primary_busy':
      return t(
        'tasks.board.start.error.primaryBusy',
        'Another task is running in the primary checkout.'
      )
    case 'agent_unavailable':
      if (role) {
        return t(
          'tasks.board.start.error.roleAgentUnavailable',
          'The agent chosen for {{role}} is not available on this host.',
          { role: roleLabel(role, t) }
        )
      }
      return t(
        'tasks.board.start.error.agentUnavailable',
        "The orchestrator's agent is not available on this host."
      )
    case 'account_needs_sign_in':
      if (role) {
        return t(
          'tasks.board.start.error.roleAccountNeedsSignIn',
          'Sign in to the account chosen for {{role}}, then start again.',
          { role: roleLabel(role, t) }
        )
      }
      return t(
        'tasks.board.start.error.accountNeedsSignIn',
        "Sign in to the orchestrator's account, then start again."
      )
    case 'remote_account_unsupported':
      return t(
        'tasks.board.start.error.remoteAccountUnsupported',
        'Managed Claude accounts do not run on SSH projects. For {{role}}, choose “Claude” to use the server’s own login.',
        { role: roleLabel(role ?? 'orchestrator', t) }
      )
    case 'worktree_create_failed':
      return t('tasks.board.start.error.worktreeCreateFailed', 'Could not create the worktree.')
    case 'primary_status_failed':
      return t(
        'tasks.board.start.error.primaryStatusFailed',
        "Could not read the primary checkout's status."
      )
    case 'primary_branch_failed':
      return t(
        'tasks.board.start.error.primaryBranchFailed',
        'Could not create the task branch in the primary checkout. Check pending changes and try again.'
      )
    case 'base_update_failed':
      return t(
        'tasks.board.start.error.baseUpdateFailed',
        'Could not update the base branch from the remote. Check your connection and try again.'
      )
    case 'context_fetch_failed':
      return t('tasks.board.start.error.contextFetchFailed', 'Could not read the issue.')
    case 'launch_failed':
      return t('tasks.board.start.error.launchFailed', 'The orchestrator did not start.')
    case 'cancelled':
      return t('tasks.board.start.error.cancelled', 'The start was cancelled.')
    case 'repo_unresolved':
      return t('tasks.board.start.error.repoUnresolved', 'Choose a repository for this task.')
    case 'primary_needs_confirmation':
      return t(
        'tasks.board.start.error.primaryNeedsConfirmation',
        'The primary checkout needs your confirmation.'
      )
  }
}

export function taskStartPrimaryReason(reason: TaskStartPrimaryReason, t: Translate): string {
  switch (reason) {
    case 'uncommitted':
      return t('tasks.board.start.primaryReason.uncommitted', 'It has uncommitted changes.')
    case 'other-branch':
      return t(
        'tasks.board.start.primaryReason.otherBranch',
        'It is on a branch other than the base branch.'
      )
  }
}

/** `workers` is null when the preview could not count them. */
export function taskStopTitle(workers: number | null, t: Translate): string {
  if (workers === null || workers === 0) {
    return t('tasks.board.start.stopConfirm.titleNoAgents', 'Stop the orchestrator?')
  }
  return workers === 1
    ? t('tasks.board.start.stopConfirm.title_one', 'Stop the orchestrator and {{count}} agent?', {
        count: workers
      })
    : t(
        'tasks.board.start.stopConfirm.title_other',
        'Stop the orchestrator and {{count}} agents?',
        {
          count: workers
        }
      )
}
