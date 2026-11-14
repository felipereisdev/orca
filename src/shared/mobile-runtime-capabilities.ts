import { NOTIFICATIONS_DESKTOP_PRESENCE_RUNTIME_CAPABILITY } from './desktop-client-presence'
import { MOBILE_RELAY_RUNTIME_CAPABILITIES } from './mobile-desktop-relay-contract'

// Hosts without this capability have no notifications.registerPush RPC.
export const NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY = 'notifications.remote-push.v1' as const

// Hosts without this capability lack one of the five taskBoard.* methods the mobile board calls.
export const MOBILE_TASK_BOARD_RUNTIME_CAPABILITY = 'mobile.task-board.v1' as const

export const MOBILE_RUNTIME_CAPABILITIES = [
  'mobile.tasks.v1',
  MOBILE_TASK_BOARD_RUNTIME_CAPABILITY,
  NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY,
  NOTIFICATIONS_DESKTOP_PRESENCE_RUNTIME_CAPABILITY,
  ...MOBILE_RELAY_RUNTIME_CAPABILITIES
] as const
