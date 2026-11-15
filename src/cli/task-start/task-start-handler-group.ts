import type { HandlerGroup } from '../dispatch/handler-group-manifest'

export const TASK_START_HANDLER_GROUP: HandlerGroup = {
  name: 'task-start',
  keys: ['task-start phase'],
  load: async () => (await import('./task-start.js')).TASK_START_HANDLERS
}
