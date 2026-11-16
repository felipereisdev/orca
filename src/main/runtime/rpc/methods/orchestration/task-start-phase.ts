import type { z } from 'zod'
import { OrchestrationTaskStartPhaseParams } from '../../../../../shared/rpc-contract/task-board/task-board-params'
import type { TaskStartPhaseResult } from '../../../../../shared/task-board/task-board-wire-types'
import {
  summarizeTaskStartRun,
  type TaskStartRun
} from '../../../../../shared/task-board/task-start-run'
import { stopTaskStartWatcher } from '../../../../task-board/task-start-lifecycle'
import { getTaskStartRunStore } from '../../../../task-board/task-start-lifecycle-deps'
import type { TaskStartRunPatch } from '../../../../task-board/task-start-run-store'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import type { RpcContext } from '../../core'
import { defineOrchestrationMethod } from './access/orchestration-method-access'

type PhaseParams = z.infer<typeof OrchestrationTaskStartPhaseParams>

const NO_EFFECTS = { effectsApplied: false }

function invalid(message: string): OrchestrationError {
  return new OrchestrationError('invalid_argument', message, NO_EFFECTS)
}

/** The run whose orchestrator is calling: its chat session, or its verified Orca terminal. */
function callerRun(ctx: RpcContext): TaskStartRun | null {
  const store = getTaskStartRunStore(ctx.runtime)
  const caller = ctx.orchestrationCaller
  if (caller) {
    if (caller.kind === 'peer') {
      return null
    }
    // The launched session is the /clear root the caller's party is named by.
    return (
      store.findByOrchestrator({ sessionId: caller.orcaSessionId }) ??
      store.findByOrchestrator({ sessionId: caller.sessionId })
    )
  }
  // PTY and SSH: the pane and launch secret prove which terminal calls, not a claimed handle.
  const terminal = ctx.runtime.verifyOrchestrationCompatibilityCaller(
    ctx.orchestrationCompatibilityEvidence,
    { currentRuntimeLaunchSufficient: true }
  )
  return terminal
    ? store.findByOrchestrator({ handle: terminal.terminalHandle, paneKey: terminal.paneKey })
    : null
}

function phasePatch(params: PhaseParams, run: TaskStartRun): TaskStartRunPatch {
  const { phase, current, total, step } = params
  const counted = current !== undefined || total !== undefined || step !== undefined
  if (counted && phase !== 'development') {
    throw invalid(
      '--current, --total and --step apply only to development. No effects were applied.'
    )
  }
  if (counted && (current === undefined || total === undefined || current > total)) {
    throw invalid(
      'Pass --current <n> and --total <m> together, with n ≤ m. No effects were applied.'
    )
  }
  const note = params.note
  if (phase === 'waiting') {
    // The stage and its percent stay; only the state says the user is needed.
    return { state: 'waiting', note, title: run.cardTitle ?? run.cardKey }
  }
  return {
    state: phase === 'completed' ? 'completed' : 'running',
    phase,
    progress:
      current !== undefined && total !== undefined
        ? { current, total, ...(step ? { step } : {}) }
        : undefined,
    note
  }
}

function reportTaskStartPhase(params: PhaseParams, ctx: RpcContext): TaskStartPhaseResult {
  const run = callerRun(ctx)
  if (!run) {
    throw new OrchestrationError(
      'not_task_orchestrator',
      'Only the orchestrator of a running task-board start can report its phase. No effects were applied.',
      NO_EFFECTS
    )
  }
  const store = getTaskStartRunStore(ctx.runtime)
  // A stop in progress wins; the report is answered, not recorded.
  const next = store.transition(run.id, ['running', 'waiting'], phasePatch(params, run))
  if (next?.state === 'completed') {
    stopTaskStartWatcher(store, run.id)
  }
  return { run: summarizeTaskStartRun(next ?? store.getById(run.id) ?? run), applied: !!next }
}

export const ORCHESTRATION_TASK_START_METHODS = [
  defineOrchestrationMethod({
    name: 'orchestration.taskStartPhase',
    // A task-board run of this Orca: no paired Orca reports for it.
    access: { kind: 'localOnly', targets: {} },
    permission: 'workspace',
    params: OrchestrationTaskStartPhaseParams,
    handler: (params, ctx): TaskStartPhaseResult => reportTaskStartPhase(params, ctx)
  })
]
