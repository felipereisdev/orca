import React from 'react'
import { AlertCircle, CheckCircle2, CircleStop, Loader2, MessageCircleQuestion } from 'lucide-react'

import { Progress } from '@/components/ui/progress'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  TaskStartFailure,
  TaskStartPhase,
  TaskStartRunSummary
} from '../../../../shared/task-board/task-start-run'

type RunTone = 'working' | 'attention' | 'success' | 'muted' | 'destructive'

const TONE_TEXT: Record<RunTone, string> = {
  working: 'text-agent-working',
  attention: 'text-agent-question-text',
  success: 'text-status-success',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive'
}

function runTone(run: TaskStartRunSummary): RunTone {
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

function phaseLabel(phase: TaskStartPhase, t: Translate): string {
  switch (phase) {
    case 'starting':
      return t('taskStart.phase.starting', 'Starting')
    case 'planning':
      return t('taskStart.phase.planning', 'Planning')
    case 'plan-review':
      return t('taskStart.phase.planReview', 'Plan review')
    case 'qa-script':
      return t('taskStart.phase.qaScript', 'QA script')
    case 'development':
      return t('taskStart.phase.development', 'Development')
    case 'final-review':
      return t('taskStart.phase.finalReview', 'Final review')
    case 'qa':
      return t('taskStart.phase.qa', 'QA')
    case 'completed':
      return t('taskStart.phase.completed', 'Completed')
  }
}

/** The state when it is not the phase's own progress: waiting, stopping, stopped or failed. */
function sideStateLabel(run: TaskStartRunSummary, t: Translate): string | null {
  switch (run.state) {
    case 'waiting':
      return t('taskStart.state.waiting', 'Waiting for you')
    case 'stopping':
      return t('taskStart.state.stopping', 'Stopping…')
    case 'stopped':
      return t('taskStart.state.stopped', 'Stopped')
    case 'failed':
      return t('taskStart.state.failed', 'Error')
    case 'running':
    case 'completed':
      return null
  }
}

/** `n/m · implementing|reviewing` while developing; native-driven plans report no step. */
function developmentDetail(run: TaskStartRunSummary, t: Translate): string | null {
  const { progress } = run
  if (run.phase !== 'development' || !progress || !(progress.total > 0)) {
    return null
  }
  const vars = { current: progress.current, total: progress.total }
  if (progress.step === 'reviewing') {
    return t('taskStart.progress.reviewing', '{{current}}/{{total}} · reviewing', vars)
  }
  if (progress.step === 'implementing') {
    return t('taskStart.progress.implementing', '{{current}}/{{total}} · implementing', vars)
  }
  return `${progress.current}/${progress.total}`
}

function failureLabel(failure: TaskStartFailure, t: Translate): string {
  switch (failure) {
    case 'orchestrator-exited':
      return t('taskStart.failure.orchestratorExited', 'The orchestrator session ended')
    case 'launch-failed':
      return t('taskStart.failure.launchFailed', 'The orchestrator did not start')
    case 'context-fetch-failed':
      return t('taskStart.failure.contextFetchFailed', 'Could not read the issue')
    case 'worktree-create-failed':
      return t('taskStart.failure.worktreeCreateFailed', 'Could not create the worktree')
    case 'prompt-unconfirmed':
      return t('taskStart.openOrchestrator', 'Open the orchestrator session')
    case 'stop-unconfirmed':
      return t('taskStart.failure.stopUnconfirmed', 'Stop not confirmed. Stop again.')
    case 'cancelled':
      return t('taskStart.failure.cancelled', 'Start cancelled')
  }
}

/** One muted line under the bar: the failure, the unconfirmed prompt, or the orchestrator's note. */
function runHint(run: TaskStartRunSummary, t: Translate): string | null {
  if (run.failure && (run.state === 'failed' || run.state === 'stopping')) {
    return failureLabel(run.failure, t)
  }
  if (run.note === 'prompt-unconfirmed') {
    return t('taskStart.openOrchestrator', 'Open the orchestrator session')
  }
  if (run.note === 'stop-forced') {
    return t('taskStart.stopForced', 'Run forgotten. Its agents may still be running.')
  }
  if (run.note === 'move-skipped') {
    return t('taskStart.moveSkipped', "Couldn't move the card to In progress — move it manually.")
  }
  return run.note ?? null
}

function RunIcon({ tone, state }: { tone: RunTone; state: TaskStartRunSummary['state'] }) {
  const className = cn('size-3 shrink-0', TONE_TEXT[tone])
  if (tone === 'attention') {
    return <MessageCircleQuestion className={className} />
  }
  if (tone === 'success') {
    return <CheckCircle2 className={className} />
  }
  if (tone === 'destructive') {
    return <AlertCircle className={className} />
  }
  if (state === 'stopped') {
    return <CircleStop className={className} />
  }
  return <Loader2 className={cn(className, 'animate-spin motion-reduce:animate-none')} />
}

/** The card's task-start progress: phase and percent over a thin bar; opens the orchestrator. */
export function TaskBoardCardRunProgress({
  run,
  onOpen
}: {
  run: TaskStartRunSummary
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const tone = runTone(run)
  const side = sideStateLabel(run, t)
  const phase = phaseLabel(run.phase, t)
  const detail = developmentDetail(run, t)
  const hint = runHint(run, t)
  const canOpen = Boolean(run.orchestrator?.worktreeId ?? run.worktreeId)
  return (
    <button
      type="button"
      disabled={!canOpen}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      aria-label={t('taskStart.openRun', 'Open the orchestrator: {{status}}, {{percent}}%', {
        status: [side, phase, detail].filter(Boolean).join(' · '),
        percent: run.percent
      })}
      className={cn(
        'mt-2 block w-full min-w-0 rounded-md text-left outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default',
        tone === 'attention' &&
          'bg-agent-question/10 px-1.5 py-1 ring-1 ring-inset ring-agent-question/25'
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-2xs">
        <RunIcon tone={tone} state={run.state} />
        <span
          className={cn(
            'shrink-0 font-medium',
            tone === 'attention' ? 'text-agent-question-text' : 'text-foreground'
          )}
        >
          {side ?? phase}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          {[side ? phase : null, detail].filter(Boolean).join(' · ')}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{run.percent}%</span>
      </span>
      <Progress value={run.percent} size="thin" tone={tone} className="mt-1" />
      {hint ? (
        <span className="mt-1 block truncate text-3xs text-muted-foreground" title={hint}>
          {hint}
        </span>
      ) : null}
    </button>
  )
}
