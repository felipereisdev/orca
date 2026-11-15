// Announced only with all five taskBoard.* methods; older hosts get "Update Orca on the host".
export const TASK_BOARD_RUNTIME_CAPABILITY = 'task-board.v1' as const
export const TASK_BOARD_UPDATE_REQUIRED = 'Update Orca on the host to use My board.'

// Hosts with taskBoard.startTask/stopTask; older hosts hide the card's start and stop buttons.
export const TASK_BOARD_START_RUNTIME_CAPABILITY = 'task-board.start.v1' as const
