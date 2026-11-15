import {
  TaskBoardAddCommentParams,
  TaskBoardDetailParams,
  TaskBoardListParams,
  TaskBoardMarkSeenParams,
  TaskBoardMoveParams,
  TaskBoardStartOptionsParams,
  TaskBoardStartTaskParams,
  TaskBoardStopTaskParams
} from '../../../../../shared/rpc-contract/task-board-params'
import { createTaskBoardServiceDeps } from '../../../../task-board/task-board-host-deps'
import { moveTaskBoardCard } from '../../../../task-board/task-board-host-move'
import {
  addTaskBoardComment,
  getTaskBoardDetail,
  listTaskBoard,
  markTaskBoardSeen
} from '../../../../task-board/task-board-host-service'
import { getTaskStartOptions } from '../../../../task-board/task-start-options'
import { createTaskStartOptionsDeps } from '../../../../task-board/task-start-options-deps'
import { startTaskFromCard } from '../../../../task-board/task-start-service'
import { createTaskStartServiceDeps } from '../../../../task-board/task-start-service-deps'
import { stopTaskFromCard } from '../../../../task-board/task-start-stop-deps'
import { defineMethod } from '../../core'

// The board is the called host's: its accounts, repos, columns and read markers.
export const TASK_BOARD_METHODS = [
  defineMethod({
    name: 'taskBoard.list',
    permission: 'workspace',
    params: TaskBoardListParams,
    handler: (params, { runtime, signal }) =>
      listTaskBoard(createTaskBoardServiceDeps(runtime), {
        fresh: params.fresh === true,
        ...(signal ? { signal } : {})
      })
  }),
  defineMethod({
    name: 'taskBoard.detail',
    permission: 'workspace',
    params: TaskBoardDetailParams,
    handler: (params, { runtime }) =>
      getTaskBoardDetail(createTaskBoardServiceDeps(runtime), params.ref)
  }),
  defineMethod({
    name: 'taskBoard.addComment',
    permission: 'workspace',
    params: TaskBoardAddCommentParams,
    handler: (params, { runtime }) =>
      addTaskBoardComment(createTaskBoardServiceDeps(runtime), params.ref, params.body)
  }),
  defineMethod({
    name: 'taskBoard.markSeen',
    permission: 'workspace',
    params: TaskBoardMarkSeenParams,
    handler: (params, { runtime }) => {
      markTaskBoardSeen(createTaskBoardServiceDeps(runtime), params.ref, {
        at: params.at,
        id: params.id
      })
      return { ok: true as const }
    }
  }),
  defineMethod({
    name: 'taskBoard.move',
    permission: 'workspace',
    params: TaskBoardMoveParams,
    handler: (params, { runtime }) => moveTaskBoardCard(params, createTaskBoardServiceDeps(runtime))
  }),
  defineMethod({
    name: 'taskBoard.startOptions',
    permission: 'workspace',
    params: TaskBoardStartOptionsParams,
    handler: (params, { runtime }) =>
      getTaskStartOptions(params, createTaskStartOptionsDeps(runtime))
  }),
  defineMethod({
    name: 'taskBoard.startTask',
    permission: 'workspace',
    params: TaskBoardStartTaskParams,
    handler: (params, context) =>
      startTaskFromCard(params, createTaskStartServiceDeps(context.runtime, context))
  }),
  defineMethod({
    name: 'taskBoard.stopTask',
    permission: 'workspace',
    params: TaskBoardStopTaskParams,
    handler: (params, { runtime }) => stopTaskFromCard(runtime, params.ref, params.preview === true)
  })
]
