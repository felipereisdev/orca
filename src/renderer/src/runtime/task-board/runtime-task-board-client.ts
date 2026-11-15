import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  TASK_BOARD_RUNTIME_CAPABILITY,
  TASK_BOARD_START_RUNTIME_CAPABILITY,
  TASK_BOARD_UPDATE_REQUIRED
} from '../../../../shared/task-board/task-board-runtime-capability'
import type {
  TaskStartRoles,
  TaskStartWorkspaceMode
} from '../../../../shared/task-board/task-start-settings'
import type {
  TaskBoardAddCommentResult,
  TaskBoardCardRef,
  TaskBoardDetailResult,
  TaskBoardListResult,
  TaskBoardMoveFields,
  TaskBoardMoveResult,
  TaskStartOptionsResult,
  TaskStartResult,
  TaskStopResult
} from '../../../../shared/task-board/task-board-wire-types'
import { assertRuntimeEnvironmentCapability } from '../rpc/compatibility/runtime-capability-proof'
import { callRuntimeRpc } from '../rpc/calls/runtime-rpc-call'

const CAPABILITY_TIMEOUT_MS = 15_000
// A fresh list reads every provider and enriches each card on the host.
const LIST_TIMEOUT_MS = 120_000
const WRITE_TIMEOUT_MS = 60_000
const READ_TIMEOUT_MS = 30_000
// A start creates the worktree, reads the issue and its images, then launches the orchestrator.
const START_TIMEOUT_MS = 120_000

/** The board is the host's: a host without the service gets an update hint instead of a method error. */
async function callTaskBoard<TResult>(
  target: RuntimeClientTarget,
  method: string,
  params: unknown,
  options: {
    timeoutMs: number
    signal?: AbortSignal
    capability?: typeof TASK_BOARD_RUNTIME_CAPABILITY | typeof TASK_BOARD_START_RUNTIME_CAPABILITY
  }
): Promise<TResult> {
  if (target.kind === 'environment') {
    await assertRuntimeEnvironmentCapability(
      target.environmentId,
      options.capability ?? TASK_BOARD_RUNTIME_CAPABILITY,
      translate('taskBoard.hostUpdateRequired', TASK_BOARD_UPDATE_REQUIRED),
      CAPABILITY_TIMEOUT_MS
    )
  }
  const { capability: _capability, ...rpcOptions } = options
  return callRuntimeRpc<TResult>(target, method, params, rpcOptions)
}

export function listTaskBoard(
  target: RuntimeClientTarget,
  options: { fresh?: boolean; signal?: AbortSignal } = {}
): Promise<TaskBoardListResult> {
  return callTaskBoard(target, 'taskBoard.list', options.fresh ? { fresh: true } : {}, {
    timeoutMs: LIST_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {})
  })
}

export function getTaskBoardDetail(
  target: RuntimeClientTarget,
  ref: TaskBoardCardRef
): Promise<TaskBoardDetailResult> {
  return callTaskBoard(target, 'taskBoard.detail', { ref }, { timeoutMs: READ_TIMEOUT_MS })
}

export function addTaskBoardComment(
  target: RuntimeClientTarget,
  ref: TaskBoardCardRef,
  body: string
): Promise<TaskBoardAddCommentResult> {
  return callTaskBoard(
    target,
    'taskBoard.addComment',
    { ref, body },
    { timeoutMs: WRITE_TIMEOUT_MS }
  )
}

/** `newest`: the newest comment the client rendered for the card. */
export async function markTaskBoardSeen(
  target: RuntimeClientTarget,
  ref: TaskBoardCardRef,
  newest: { at: string; id: string }
): Promise<void> {
  await callTaskBoard(
    target,
    'taskBoard.markSeen',
    { ref, at: newest.at, id: newest.id },
    { timeoutMs: READ_TIMEOUT_MS }
  )
}

export function moveTaskBoardCard(
  target: RuntimeClientTarget,
  params: {
    ref: TaskBoardCardRef
    targetColumnId: string
    choiceId?: string
    fields?: TaskBoardMoveFields
  }
): Promise<TaskBoardMoveResult> {
  return callTaskBoard(target, 'taskBoard.move', params, { timeoutMs: WRITE_TIMEOUT_MS })
}

/** Start-task options (catalog, saved roles) for a card or repo; needs a host with the start capability. */
export function getTaskStartOptions(
  target: RuntimeClientTarget,
  params: { ref?: TaskBoardCardRef; repoId?: string },
  options: { signal?: AbortSignal } = {}
): Promise<TaskStartOptionsResult> {
  return callTaskBoard(target, 'taskBoard.startOptions', params, {
    timeoutMs: READ_TIMEOUT_MS,
    capability: TASK_BOARD_START_RUNTIME_CAPABILITY,
    ...(options.signal ? { signal: options.signal } : {})
  })
}

export type TaskStartParams = {
  ref: TaskBoardCardRef
  repoId?: string
  workspaceMode?: TaskStartWorkspaceMode
  baseRef?: string
  roles?: TaskStartRoles
  confirmPrimary?: boolean
}

/** ▶︎ / "Start as…": the host creates the workspace and launches the card's orchestrator. */
export function startTask(
  target: RuntimeClientTarget,
  params: TaskStartParams
): Promise<TaskStartResult> {
  return callTaskBoard(target, 'taskBoard.startTask', params, {
    timeoutMs: START_TIMEOUT_MS,
    capability: TASK_BOARD_START_RUNTIME_CAPABILITY
  })
}

/** ⏹; `preview` only counts the agents a stop would end; `force` forgets an unconfirmed stop. */
export function stopTask(
  target: RuntimeClientTarget,
  params: { ref: TaskBoardCardRef; preview?: boolean; force?: boolean }
): Promise<TaskStopResult> {
  return callTaskBoard(target, 'taskBoard.stopTask', params, {
    timeoutMs: WRITE_TIMEOUT_MS,
    capability: TASK_BOARD_START_RUNTIME_CAPABILITY
  })
}
