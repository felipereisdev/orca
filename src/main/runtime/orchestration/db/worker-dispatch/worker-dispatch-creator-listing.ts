import type { OrchestrationCoordinatorKey } from '../../addressing/orchestration-caller-identity'
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

export type WorkerDispatchCreatorListingMethods = {
  listLiveWorkerDispatchIdsCreatedBy: typeof listLiveWorkerDispatchIdsCreatedBy
}

export function attachWorkerDispatchCreatorListing(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, { listLiveWorkerDispatchIdsCreatedBy })
}
