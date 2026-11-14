import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'
import type { TaskProvider } from '../../../src/shared/work-items/task-providers'
import { MOBILE_TASK_BOARD_RUNTIME_CAPABILITY } from '../../../src/shared/mobile-runtime-capabilities'
import { loadTasksSurface, type TasksSurface } from '../storage/tasks-surface-preference'

export function mobileTasksRouteTarget(
  hostId: string,
  provider?: TaskProvider
): HostStackRouteTarget {
  return {
    name: '[hostId]/tasks',
    params: provider ? { hostId, taskSource: provider } : { hostId }
  }
}

export function mobileTaskBoardRouteTarget(hostId: string): HostStackRouteTarget {
  return { name: '[hostId]/board', params: { hostId } }
}

// My board and the provider lists are two views of Tasks: switching replaces one with the other.
export function mobileTaskBoardHref(hostId: string): `/h/${string}` {
  return `/h/${encodeURIComponent(hostId)}/board`
}

export function mobileTaskListsHref(hostId: string): `/h/${string}` {
  return `/h/${encodeURIComponent(hostId)}/tasks`
}

/** Null capabilities: the host's status is not known yet. */
export function hostServesTaskBoard(hostCapabilities: readonly string[] | null): boolean {
  return hostCapabilities?.includes(MOBILE_TASK_BOARD_RUNTIME_CAPABILITY) ?? false
}

/**
 * The view Tasks opens on: My board only where the user last chose it and the host announced it.
 * An older host's page has no board route, so the shell would draw a wall with no way back.
 */
export async function mobileTasksEntrySurface(
  hostId: string,
  hostCapabilities: readonly string[] | null
): Promise<TasksSurface> {
  return hostServesTaskBoard(hostCapabilities) ? loadTasksSurface(hostId) : 'lists'
}

export async function mobileTasksEntryHref(
  hostId: string,
  hostCapabilities: readonly string[] | null
): Promise<`/h/${string}`> {
  return (await mobileTasksEntrySurface(hostId, hostCapabilities)) === 'board'
    ? mobileTaskBoardHref(hostId)
    : mobileTaskListsHref(hostId)
}
