import type { OrchestrationCoordinatorKey } from '../../addressing/orchestration-caller-identity'
import type { OrchestrationDb } from '../orchestration-db'
import { isEquivalentPaneKey, paneKeyMatchSuffix } from '../pane-key-match'
import { isRemoteDispatchTerminal } from './remote-dispatch-records'

type CreatedRow = {
  id: string
  runId: string
  status: string
  workerState: string | null
  creatorHandle: string | null
  creatorPaneKey: string | null
}

// A server-owned attempt keeps no creator; its Task does (reserveRemotePlacement writes it). The
// suffix prefilter narrows pane candidates, isEquivalentPaneKey decides.
const CREATOR_MATCH_SQL = `(
    (t.created_by_pane_key IS NOT NULL
      AND substr(t.created_by_pane_key, instr(t.created_by_pane_key, ':') + 1) = ?)
    OR t.created_by_terminal_handle = ?
    OR (t.created_by_terminal_handle IS NULL AND t.created_by_pane_key IS NULL AND t.run_id IN
      (SELECT value FROM json_each(?)))
  )`

const REMOTE_DISPATCHES_SQL = `SELECT r.dispatch_id AS id, r.run_id AS runId, r.status AS status,
    r.worker_state AS workerState, t.created_by_terminal_handle AS creatorHandle,
    t.created_by_pane_key AS creatorPaneKey
  FROM remote_dispatches r JOIN tasks t ON t.id = r.task_id
  WHERE ${CREATOR_MATCH_SQL} ORDER BY r.rowid`

const RESERVED_PLACEMENTS_SQL = `SELECT p.task_id AS id, p.run_id AS runId, 'pending' AS status,
    NULL AS workerState, t.created_by_terminal_handle AS creatorHandle,
    t.created_by_pane_key AS creatorPaneKey
  FROM remote_placements p JOIN tasks t ON t.id = p.task_id
  WHERE p.state = 'reserved' AND ${CREATOR_MATCH_SQL} ORDER BY p.rowid`

function createdBy(
  db: OrchestrationDb,
  sql: string,
  coordinator: OrchestrationCoordinatorKey
): CreatedRow[] {
  const { terminalHandle, paneKey, orcaSessionId } = coordinator
  // A chat's Tasks carry no creator: only the Runs it coordinates now can stand for it.
  const chatRuns = orcaSessionId ? db.runsBoundToCoordinator(coordinator).map((run) => run.id) : []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: both SELECTs alias exactly these columns.
  const rows = db.db
    .prepare(sql)
    .all(
      paneKey ? paneKeyMatchSuffix(paneKey) : null,
      terminalHandle,
      JSON.stringify(chatRuns)
    ) as CreatedRow[]
  return rows.filter(
    (row) =>
      (paneKey !== null &&
        row.creatorPaneKey !== null &&
        isEquivalentPaneKey(row.creatorPaneKey, paneKey)) ||
      (terminalHandle !== null && row.creatorHandle === terminalHandle) ||
      (row.creatorHandle === null && row.creatorPaneKey === null && chatRuns.includes(row.runId))
  )
}

/** Unsettled Dispatches servers that own their workers run for Tasks this coordinator created. */
export function listLiveRemoteOwnedDispatchIdsCreatedBy(
  db: OrchestrationDb,
  coordinator: OrchestrationCoordinatorKey
): string[] {
  return createdBy(db, REMOTE_DISPATCHES_SQL, coordinator)
    .filter(
      (row) => !isRemoteDispatchTerminal({ status: row.status, worker_state: row.workerState })
    )
    .map((row) => row.id)
}

/** Starts this coordinator sent to a server that has not answered yet: no Dispatch to stop. */
export function countReservedRemoteStartsCreatedBy(
  db: OrchestrationDb,
  coordinator: OrchestrationCoordinatorKey
): number {
  return createdBy(db, RESERVED_PLACEMENTS_SQL, coordinator).length
}
