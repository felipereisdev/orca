import type {
  TaskStartError,
  TaskStartPrimaryReason,
  TaskStartResult
} from '../../shared/task-board/task-board-wire-types'
import {
  summarizeTaskStartRun,
  type TaskStartFailure,
  type TaskStartOrchestratorRef,
  type TaskStartRun
} from '../../shared/task-board/task-start-run'
import { stopTaskStartWatcher, type TaskStartLifecycleDeps } from './task-start-lifecycle'
import type { TaskStartRunPatch } from './task-start-run-store'

/** The start's view of its own run; every write is conditional on the run still being live. */
export type TaskStartRunGuard = {
  runId: string
  /** Set once the worktree exists, so a cancelled run still records it. */
  worktreeId?: string
  alive(): boolean
  patch(patch: TaskStartRunPatch): TaskStartRun | null
  fail(failure: TaskStartFailure, error: TaskStartError): Promise<TaskStartResult>
  /** The run left running/waiting: a stop cancels the start (closing `published`); any other
   *  end (the watcher's `orchestrator-exited`, say) is reported as it is, closing nothing. */
  settle(published?: TaskStartOrchestratorRef): Promise<TaskStartResult>
}

type GuardDeps = {
  lifecycle: TaskStartLifecycleDeps
  closeOrchestrator(ref: TaskStartOrchestratorRef): Promise<void>
}

const LIVE = ['running', 'waiting'] as const

const FAILURE_ERRORS: Partial<Record<TaskStartFailure, TaskStartError>> = {
  'context-fetch-failed': 'context_fetch_failed',
  'worktree-create-failed': 'worktree_create_failed',
  cancelled: 'cancelled'
}

export function refuseTaskStart(
  error: TaskStartError,
  run?: TaskStartRun | null,
  reasons?: TaskStartPrimaryReason[]
): TaskStartResult {
  return {
    ok: false,
    error,
    ...(reasons ? { reasons } : {}),
    ...(run ? { run: summarizeTaskStartRun(run) } : {})
  }
}

export function createTaskStartRunGuard(runId: string, deps: GuardDeps): TaskStartRunGuard {
  const { store } = deps.lifecycle
  const guard: TaskStartRunGuard = {
    runId,
    alive: () => {
      const state = store.getById(runId)?.state
      return state === 'running' || state === 'waiting'
    },
    patch: (patch) => store.transition(runId, [...LIVE], patch),
    fail: async (failure, error) => {
      const failed = store.transition(runId, [...LIVE], { state: 'failed', failure })
      return failed ? refuseTaskStart(error, failed) : guard.settle()
    },
    settle: async (published) => {
      const run = store.getById(runId)
      if (run?.state !== 'stopping') {
        return refuseTaskStart(
          (run?.failure && FAILURE_ERRORS[run.failure]) ?? 'launch_failed',
          run
        )
      }
      // A stop arrived mid-start: close what this start opened (never the worktree).
      if (published) {
        await deps.closeOrchestrator(published).catch((error: unknown) => {
          console.warn('[task-start] closing a cancelled orchestrator failed', error)
        })
      }
      stopTaskStartWatcher(store, runId)
      const stopped = store.transition(runId, ['stopping'], {
        state: 'stopped',
        failure: 'cancelled',
        ...(guard.worktreeId ? { worktreeId: guard.worktreeId } : {})
      })
      return refuseTaskStart('cancelled', stopped ?? store.getById(runId))
    }
  }
  return guard
}
