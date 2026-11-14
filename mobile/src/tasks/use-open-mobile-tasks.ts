import { useCallback } from 'react'
import { useOpenHostStackRoute } from '../navigation/use-open-host-stack-route'
import { loadTasksSurface } from '../storage/preferences'
import { mobileTaskBoardRouteTarget, mobileTasksRouteTarget } from './mobile-task-navigation'
import type { TaskProvider } from '../../../src/shared/work-items/task-providers'

export function useOpenMobileTasks(): (hostId: string, provider?: TaskProvider) => void {
  const openHostStackRoute = useOpenHostStackRoute()

  return useCallback(
    (hostId, provider) => {
      if (provider) {
        openHostStackRoute(hostId, mobileTasksRouteTarget(hostId, provider))
        return
      }
      // Without a named provider, Tasks opens on the view the user last switched to.
      void loadTasksSurface().then((surface) =>
        openHostStackRoute(
          hostId,
          surface === 'board' ? mobileTaskBoardRouteTarget(hostId) : mobileTasksRouteTarget(hostId)
        )
      )
    },
    [openHostStackRoute]
  )
}
