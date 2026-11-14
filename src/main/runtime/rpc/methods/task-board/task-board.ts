import {
  TaskBoardAddCommentParams,
  TaskBoardDetailParams,
  TaskBoardListParams,
  TaskBoardMarkSeenParams
} from '../../../../../shared/rpc-contract/task-board-params'
import { createTaskBoardServiceDeps } from '../../../../task-board/task-board-host-deps'
import {
  addTaskBoardComment,
  getTaskBoardDetail,
  listTaskBoard,
  markTaskBoardSeen
} from '../../../../task-board/task-board-host-service'
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
  })
]
