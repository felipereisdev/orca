import { useCallback } from 'react'
import { useOpenHostStackRoute } from '../navigation/use-open-host-stack-route'
import { connectionHostStatus } from '../query/host-status-query'
import { useRpcClientContext } from '../transport/connection/client-context'
import {
  mobileTaskBoardRouteTarget,
  mobileTasksEntrySurface,
  mobileTasksRouteTarget
} from './mobile-task-navigation'
import type { TaskProvider } from '../../../src/shared/work-items/task-providers'

export function useOpenMobileTasks(): (hostId: string, provider?: TaskProvider) => void {
  const openHostStackRoute = useOpenHostStackRoute()
  const clients = useRpcClientContext()

  return useCallback(
    (hostId, provider) => {
      if (provider) {
        openHostStackRoute(hostId, mobileTasksRouteTarget(hostId, provider))
        return
      }
      // The status this host's connection already proved; none yet means the lists.
      const client = clients.getAllClients().find((entry) => entry.hostId === hostId)?.client
      const status = client ? connectionHostStatus(client)?.status : undefined
      void mobileTasksEntrySurface(hostId, status ? (status.capabilities ?? []) : null).then(
        (surface) =>
          openHostStackRoute(
            hostId,
            surface === 'board'
              ? mobileTaskBoardRouteTarget(hostId)
              : mobileTasksRouteTarget(hostId)
          )
      )
    },
    [clients, openHostStackRoute]
  )
}
