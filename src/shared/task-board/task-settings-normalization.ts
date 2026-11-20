import { normalizeTaskBoardSettings, type TaskBoardSettings } from './task-board-settings'
import {
  normalizeGlobalTaskStartSettings,
  type GlobalTaskStartSettings
} from './task-start-settings'

/** The board and start settings a client reads, each normalized from what the store holds. */
export function normalizeTaskSettings(settings: { taskBoard?: unknown; taskStart?: unknown }): {
  taskBoard: TaskBoardSettings
  taskStart: GlobalTaskStartSettings
} {
  return {
    taskBoard: normalizeTaskBoardSettings(settings.taskBoard),
    taskStart: normalizeGlobalTaskStartSettings(settings.taskStart)
  }
}
