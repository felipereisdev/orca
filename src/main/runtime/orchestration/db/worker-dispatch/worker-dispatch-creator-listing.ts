import { formatOrcaSessionAddress } from '../../../../../shared/orca-session-address'
import type { OrchestrationCoordinatorKey } from '../../addressing/orchestration-caller-identity'
import {
  isRemoteDispatchTerminal,
  type RemoteDispatchRow
} from '../remote-owned/remote-dispatch-records'
import { WORKER_SETTLED_STATES } from '../../terminal-authority/release/worker-terminal-ownership'
import type { OrchestrationDb } from '../orchestration-db'
import { isEquivalentPaneKey, paneKeyMatchSuffix } from '../pane-key-match'

const SETTLED_PLACEHOLDERS = WORKER_SETTLED_STATES.map(() => '?').join(', ')

// The suffix prefilter narrows pane candidates; isEquivalentPaneKey still decides.
const LIVE_CREATED_BY_SQL = `SELECT d.id AS id, d.creator_handle AS creatorHandle,
    d.creator_pane_key AS creatorPaneKey, d.creator_orca_session_id AS creatorOrcaSessionId
  FROM dispatch_contexts d JOIN worker_dispatches w ON w.dispatch_id = d.id
  WHERE w.state NOT IN (${SETTLED_PLACEHOLDERS}) AND (
    (d.creator_pane_key IS NOT NULL
      AND substr(d.creator_pane_key, instr(d.creator_pane_key, ':') + 1) = ?)
    OR d.creator_handle = ?
    OR d.creator_orca_session_id = ?
  )
  ORDER BY d.rowid`

type CreatedByRow = {
  id: string
  creatorHandle: string | null
  creatorPaneKey: string | null
  creatorOrcaSessionId: string | null
}

/** Unsettled worker Dispatches this coordinator created, in any Run: binding a new Run unbinds
 *  the coordinator's earlier ones, but their workers are still its own. */
export function listLiveWorkerDispatchIdsCreatedBy(
  this: OrchestrationDb,
  creator: OrchestrationCoordinatorKey
): string[] {
  const { terminalHandle, paneKey, orcaSessionId } = creator
  if (!terminalHandle && !paneKey && !orcaSessionId) {
    return []
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT aliases exactly these columns, as every row cast in db/ does.
  const rows = this.db
    .prepare(LIVE_CREATED_BY_SQL)
    .all(
      ...WORKER_SETTLED_STATES,
      paneKey ? paneKeyMatchSuffix(paneKey) : null,
      terminalHandle,
      orcaSessionId
    ) as CreatedByRow[]
  return rows
    .filter(
      (row) =>
        (paneKey !== null &&
          row.creatorPaneKey !== null &&
          isEquivalentPaneKey(row.creatorPaneKey, paneKey)) ||
        (terminalHandle !== null && row.creatorHandle === terminalHandle) ||
        (orcaSessionId !== null && row.creatorOrcaSessionId === orcaSessionId)
    )
    .map((row) => row.id)
}

// Runs this coordinator coordinated and nobody has bound since: binding a new Run clears the old one.
const REMEMBERED_UNBOUND_RUNS_SQL = `SELECT DISTINCT runs.id AS id
  FROM run_coordinator_handles coordinator JOIN runs ON runs.id = coordinator.run_id
  WHERE coordinator.terminal_handle IN (?, ?) AND runs.legacy = 0
    AND runs.coordinator_handle IS NULL AND runs.coordinator_pane_key IS NULL
    AND runs.coordinator_orca_session_id IS NULL`

/** Unsettled Dispatches a server that owns its workers runs for this coordinator's Runs. They keep
 *  no creator, so the Runs it coordinates, or coordinated last, stand for it. */
export function listLiveRemoteOwnedDispatchIdsCoordinatedBy(
  this: OrchestrationDb,
  coordinator: OrchestrationCoordinatorKey
): string[] {
  const { terminalHandle, orcaSessionId } = coordinator
  const runIds = new Set(this.runsBoundToCoordinator(coordinator).map((run) => run.id))
  if (terminalHandle || orcaSessionId) {
    const sessionAddress = orcaSessionId ? formatOrcaSessionAddress(orcaSessionId) : null
    for (const row of this.db
      .prepare(REMEMBERED_UNBOUND_RUNS_SQL)
      .all(terminalHandle, sessionAddress)) {
      if (typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string') {
        runIds.add(row.id)
      }
    }
  }
  const select = this.db.prepare(
    'SELECT dispatch_id, status, worker_state FROM remote_dispatches WHERE run_id = ? ORDER BY rowid'
  )
  return [...runIds].flatMap((runId) =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT names exactly these columns of the table's row type.
    (select.all(runId) as Pick<RemoteDispatchRow, 'dispatch_id' | 'status' | 'worker_state'>[])
      .filter((record) => !isRemoteDispatchTerminal(record))
      .map((record) => record.dispatch_id)
  )
}

export type WorkerDispatchCreatorListingMethods = {
  listLiveWorkerDispatchIdsCreatedBy: typeof listLiveWorkerDispatchIdsCreatedBy
  listLiveRemoteOwnedDispatchIdsCoordinatedBy: typeof listLiveRemoteOwnedDispatchIdsCoordinatedBy
}

export function attachWorkerDispatchCreatorListing(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    listLiveWorkerDispatchIdsCreatedBy,
    listLiveRemoteOwnedDispatchIdsCoordinatedBy
  })
}
