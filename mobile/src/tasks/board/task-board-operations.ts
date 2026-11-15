import type {
  TaskBoardAddCommentResult,
  TaskBoardCardRef,
  TaskBoardDetailResult,
  TaskBoardListResult,
  TaskBoardMoveFields,
  TaskStartOptionsResult,
  TaskStartResult,
  TaskStopResult
} from '../../../../src/shared/task-board/task-board-wire-types'
import type {
  TaskStartRoles,
  TaskStartWorkspaceMode
} from '../../../../src/shared/task-board/task-start-settings'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import { isTaskBoardUnavailableReply, TaskBoardUnsupportedError } from './task-board-capability'
import {
  taskBoardAddCommentSchema,
  taskBoardDetailSchema,
  taskBoardListSchema,
  taskBoardMoveSchema,
  taskBoardSeenSchema,
  type MobileTaskBoardMoveResult
} from './task-board-reply-schema'
import {
  taskStartOptionsSchema,
  taskStartResultSchema,
  taskStopResultSchema
} from './task-start-reply-schema'

// The board is the host's: every read and write goes through taskBoard.*, never a provider method.

export const taskBoardListRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.list',
    method: 'taskBoard.list',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-board', taskBoardListSchema)
  })
)

export const taskBoardDetailRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.detail',
    method: 'taskBoard.detail',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-board-detail', taskBoardDetailSchema)
  })
)

export const taskBoardCommentAdd = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.add-comment',
    method: 'taskBoard.addComment',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-board-comment', taskBoardAddCommentSchema)
  })
)

// A lost read marker only leaves a comment counted as unread; the drawer never waits on it.
export const taskBoardSeenMark = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.mark-seen-or-skip',
    method: 'taskBoard.markSeen',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-board-seen', taskBoardSeenSchema)
  })
)

export const taskBoardCardMove = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.move',
    method: 'taskBoard.move',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-board-move', taskBoardMoveSchema)
  })
)

export const taskBoardStartOptionsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.start-options',
    method: 'taskBoard.startOptions',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-start-options', taskStartOptionsSchema)
  })
)

export const taskBoardStartRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.start-task',
    method: 'taskBoard.startTask',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-start', taskStartResultSchema)
  })
)

export const taskBoardStopRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'taskBoard.stop-task',
    method: 'taskBoard.stopTask',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('task-stop', taskStopResultSchema)
  })
)

// A fresh list reads every provider and enriches each card on the host.
const LIST_TIMEOUT_MS = 120_000
const WRITE_TIMEOUT_MS = 60_000
const READ_TIMEOUT_MS = 30_000
// A start creates the worktree, reads the issue and launches the orchestrator before it answers.
const START_TIMEOUT_MS = 120_000

/** The host's board; `fresh` bypasses the host's provider caches (Refresh, after a move). */
export async function readTaskBoardList(
  client: RpcClient,
  fresh: boolean
): Promise<TaskBoardListResult> {
  const reply = await taskBoardListRead.request(client, fresh ? { fresh: true } : {}, {
    timeoutMs: LIST_TIMEOUT_MS
  })
  if (isTaskBoardUnavailableReply(reply)) {
    throw new TaskBoardUnsupportedError()
  }
  return taskBoardListRead.interpret(reply)
}

export async function readTaskBoardDetail(
  client: RpcClient,
  ref: TaskBoardCardRef
): Promise<TaskBoardDetailResult> {
  const reply = await taskBoardDetailRead.request(client, { ref }, { timeoutMs: READ_TIMEOUT_MS })
  return taskBoardDetailRead.interpret(reply)
}

export async function addTaskBoardComment(
  client: RpcClient,
  ref: TaskBoardCardRef,
  body: string
): Promise<TaskBoardAddCommentResult> {
  const reply = await taskBoardCommentAdd.request(
    client,
    { ref, body },
    { timeoutMs: WRITE_TIMEOUT_MS }
  )
  return taskBoardCommentAdd.interpret(reply)
}

/**
 * `newest`: the newest comment the drawer rendered for the card, never one it only fetched.
 * False when the host refused the marker, so the card keeps its unread count.
 */
export async function markTaskBoardSeen(
  client: RpcClient,
  ref: TaskBoardCardRef,
  newest: { at: string; id: string }
): Promise<boolean> {
  const reply = await taskBoardSeenMark.request(
    client,
    { ref, at: newest.at, id: newest.id },
    { timeoutMs: READ_TIMEOUT_MS }
  )
  return taskBoardSeenMark.interpret(reply).accepted
}

export async function moveTaskBoardCard(
  client: RpcClient,
  params: {
    ref: TaskBoardCardRef
    targetColumnId: string
    choiceId?: string
    fields?: TaskBoardMoveFields
  }
): Promise<MobileTaskBoardMoveResult> {
  const reply = await taskBoardCardMove.request(client, params, { timeoutMs: WRITE_TIMEOUT_MS })
  return taskBoardCardMove.interpret(reply)
}

/** The host's choices for "Start as…": repositories, mode, base branch and the agents of each role. */
export async function getTaskStartOptions(
  client: RpcClient,
  params: { ref?: TaskBoardCardRef; repoId?: string }
): Promise<TaskStartOptionsResult> {
  const reply = await taskBoardStartOptionsRead.request(client, params, {
    timeoutMs: READ_TIMEOUT_MS
  })
  return taskBoardStartOptionsRead.interpret(reply)
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
export async function startTask(
  client: RpcClient,
  params: TaskStartParams
): Promise<TaskStartResult> {
  const reply = await taskBoardStartRun.request(client, params, { timeoutMs: START_TIMEOUT_MS })
  return taskBoardStartRun.interpret(reply)
}

/** ⏹; `preview` only counts the agents a stop would end. */
export async function stopTask(
  client: RpcClient,
  params: { ref: TaskBoardCardRef; preview?: boolean }
): Promise<TaskStopResult> {
  const reply = await taskBoardStopRun.request(client, params, { timeoutMs: WRITE_TIMEOUT_MS })
  return taskBoardStopRun.interpret(reply)
}
