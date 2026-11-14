import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'
import type { TaskProvider } from '../../../src/shared/work-items/task-providers'
import { loadTasksSurface } from '../storage/preferences'

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

/** Tasks opens on the view the user last switched to. */
export async function mobileTasksEntryHref(hostId: string): Promise<`/h/${string}`> {
  return (await loadTasksSurface()) === 'board'
    ? mobileTaskBoardHref(hostId)
    : mobileTaskListsHref(hostId)
}
