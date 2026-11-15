import type { OrchestrationCoordinatorKey } from '../../addressing/orchestration-caller-identity'
import type { OrchestrationDb } from '../orchestration-db'
import { isEquivalentPaneKey, paneKeyMatchSuffix } from '../pane-key-match'
import { isRemoteDispatchTerminal } from './remote-dispatch-records'

type StartedRow = {
  id: string
  runId: string
  status: string
  workerState: string | null
  starterHandle: string | null
  starterPaneKey: string | null
  starterSessionId: string | null
  creatorHandle: string | null
  creatorPaneKey: string | null
}

// Prefilter only: the suffix narrows pane candidates, startedBy decides.
const PANE_SUFFIX_SQL = (column: string) =>
  `(${column} IS NOT NULL AND substr(${column}, instr(${column}, ':') + 1) = ?)`
const STARTER_MATCH_SQL = (row: string) => `(
    ${PANE_SUFFIX_SQL(`${row}.started_by_pane_key`)}
    OR ${row}.started_by_handle = ?
    OR ${row}.started_by_orca_session_id = ?
    OR ${PANE_SUFFIX_SQL('t.created_by_pane_key')}
    OR t.created_by_terminal_handle = ?
    OR (t.created_by_terminal_handle IS NULL AND t.created_by_pane_key IS NULL AND t.run_id IN
      (SELECT value FROM json_each(?)))
  )`
const STARTER_COLUMNS_SQL = (row: string) => `${row}.started_by_handle AS starterHandle,
    ${row}.started_by_pane_key AS starterPaneKey,
    ${row}.started_by_orca_session_id AS starterSessionId,
    t.created_by_terminal_handle AS creatorHandle, t.created_by_pane_key AS creatorPaneKey`

const REMOTE_DISPATCHES_SQL = `SELECT r.dispatch_id AS id, r.run_id AS runId, r.status AS status,
    r.worker_state AS workerState, ${STARTER_COLUMNS_SQL('r')}
  FROM remote_dispatches r JOIN tasks t ON t.id = r.task_id
  WHERE ${STARTER_MATCH_SQL('r')} ORDER BY r.rowid`

const RESERVED_PLACEMENTS_SQL = `SELECT p.task_id AS id, p.run_id AS runId, 'pending' AS status,
    NULL AS workerState, ${STARTER_COLUMNS_SQL('p')}
  FROM remote_placements p JOIN tasks t ON t.id = p.task_id
  WHERE p.state = 'reserved' AND ${STARTER_MATCH_SQL('p')} ORDER BY p.rowid`

function samePane(stored: string | null, paneKey: string | null): boolean {
  return paneKey !== null && stored !== null && isEquivalentPaneKey(stored, paneKey)
}

function startedBy(
  row: StartedRow,
  { terminalHandle, paneKey, orcaSessionId }: OrchestrationCoordinatorKey,
  chatRuns: string[]
): boolean {
  if (row.starterHandle !== null || row.starterPaneKey !== null || row.starterSessionId !== null) {
    return (
      samePane(row.starterPaneKey, paneKey) ||
      (terminalHandle !== null && row.starterHandle === terminalHandle) ||
      (orcaSessionId !== null && row.starterSessionId === orcaSessionId)
    )
  }
  // Recorded before starts kept their starter: the Task's creator stands for it, and for a chat
  // (whose Tasks record none) the Runs it is bound to.
  return (
    samePane(row.creatorPaneKey, paneKey) ||
    (terminalHandle !== null && row.creatorHandle === terminalHandle) ||
    (row.creatorHandle === null && row.creatorPaneKey === null && chatRuns.includes(row.runId))
  )
}

function rowsStartedBy(
  db: OrchestrationDb,
  sql: string,
  coordinator: OrchestrationCoordinatorKey
): StartedRow[] {
  const { terminalHandle, paneKey, orcaSessionId } = coordinator
  const chatRuns = orcaSessionId ? db.runsBoundToCoordinator(coordinator).map((run) => run.id) : []
  const suffix = paneKey ? paneKeyMatchSuffix(paneKey) : null
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: both SELECTs alias exactly these columns.
  const rows = db.db
    .prepare(sql)
    .all(
      suffix,
      terminalHandle,
      orcaSessionId,
      suffix,
      terminalHandle,
      JSON.stringify(chatRuns)
    ) as StartedRow[]
  return rows.filter((row) => startedBy(row, coordinator, chatRuns))
}

/** Unsettled Dispatches servers that own their workers run for starts this coordinator sent. */
export function listLiveRemoteOwnedDispatchIdsCreatedBy(
  db: OrchestrationDb,
  coordinator: OrchestrationCoordinatorKey
): string[] {
  return rowsStartedBy(db, REMOTE_DISPATCHES_SQL, coordinator)
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
  return rowsStartedBy(db, RESERVED_PLACEMENTS_SQL, coordinator).length
}
