import { useWorkspaceExecutionHost } from '../navigation/workspace-execution-host'
import type { MobileSessionController } from '../session/use-mobile-session-controller'
import { MobileDatabasePane } from './MobileDatabasePane'

export function MobileSessionDatabasePane({
  controller,
  keyboardLift
}: {
  controller: MobileSessionController
  keyboardLift: number
}) {
  const executionHost = useWorkspaceExecutionHost()
  const tab = controller.activeDatabaseTab
  return tab ? (
    <MobileDatabasePane
      key={JSON.stringify([controller.hostId, executionHost, controller.worktreeId, tab.id])}
      client={controller.client}
      hostId={controller.hostId}
      worktreeId={controller.worktreeId}
      executionHost={executionHost}
      entityId={tab.entityId}
      keyboardLift={keyboardLift}
      bottomInset={controller.insets.bottom}
    />
  ) : null
}
