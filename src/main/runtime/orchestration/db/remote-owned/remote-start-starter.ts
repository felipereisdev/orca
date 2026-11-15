import type { OrchestrationCoordinatorKey } from '../../addressing/orchestration-caller-identity'
import type { OrchestrationDb } from '../orchestration-db'
import type { RemotePlacementRow } from './remote-placement-hold'

/** The coordinator that sent a start --on a server, so that its ⏹ stops only what it started. */
export function writePlacementStarter(
  db: OrchestrationDb,
  taskId: string,
  startedBy: OrchestrationCoordinatorKey | null | undefined
): void {
  db.db
    .prepare(
      `UPDATE remote_placements SET started_by_handle = ?, started_by_pane_key = ?,
         started_by_orca_session_id = ? WHERE task_id = ?`
    )
    .run(
      startedBy?.terminalHandle ?? null,
      startedBy?.paneKey ?? null,
      startedBy?.orcaSessionId ?? null,
      taskId
    )
}

/** The attempt that answered a placement belongs to whoever sent that start. */
export function copyPlacementStarter(
  db: OrchestrationDb,
  placement: RemotePlacementRow,
  dispatchId: string
): void {
  db.db
    .prepare(
      `UPDATE remote_dispatches SET started_by_handle = ?, started_by_pane_key = ?,
         started_by_orca_session_id = ? WHERE dispatch_id = ?`
    )
    .run(
      placement.started_by_handle,
      placement.started_by_pane_key,
      placement.started_by_orca_session_id,
      dispatchId
    )
}
