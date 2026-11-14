import type {
  TaskBoardAddCommentResult,
  TaskBoardCardRef,
  TaskBoardDetailResult,
  TaskBoardListResult,
  TaskBoardMoveFields
} from '../../../../src/shared/task-board/task-board-wire-types'
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

// A fresh list reads every provider and enriches each card on the host.
const LIST_TIMEOUT_MS = 120_000
const WRITE_TIMEOUT_MS = 60_000
const READ_TIMEOUT_MS = 30_000

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

/** `newest`: the newest comment the drawer rendered for the card, never one it only fetched. */
export async function markTaskBoardSeen(
  client: RpcClient,
  ref: TaskBoardCardRef,
  newest: { at: string; id: string }
): Promise<void> {
  const reply = await taskBoardSeenMark.request(
    client,
    { ref, at: newest.at, id: newest.id },
    { timeoutMs: READ_TIMEOUT_MS }
  )
  taskBoardSeenMark.interpret(reply)
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
