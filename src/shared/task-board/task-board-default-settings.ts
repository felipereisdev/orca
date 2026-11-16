import { getDefaultTaskBoardSettings } from './task-board-settings'
import { getDefaultGlobalTaskStartSettings } from './task-start-settings'

/** The board's global settings a fresh profile starts with. */
export function getDefaultTaskBoardGlobalSettings() {
  return {
    taskBoard: getDefaultTaskBoardSettings(),
    taskStart: getDefaultGlobalTaskStartSettings()
  }
}
