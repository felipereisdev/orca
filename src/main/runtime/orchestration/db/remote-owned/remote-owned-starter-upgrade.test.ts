import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'
import { countReservedRemoteStartsCreatedBy } from './remote-owned-creator-listing'
import { reserveRemotePlacement } from './remote-placements'
import { openRemoteRunLink } from './remote-run-links'

const SERVER = {
  environmentId: 'env_b',
  name: 'devB',
  peerFingerprint: 'host_b',
  homePeerFingerprint: 'cred_a',
  pairingRevision: 1
}
const COORD = { terminalHandle: 'term_coord', paneKey: null, orcaSessionId: null }
const OTHER = { terminalHandle: 'term_other', paneKey: null, orcaSessionId: null }

describe('remote-owned starter columns on a database from an earlier build', () => {
  it('adds them on open, and lists its older starts by their Task creator', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-remote-starter-'))
    const dbPath = join(dir, 'orchestration.db')
    try {
      const earlier = new OrchestrationDb(dbPath)
      const runId = earlier.createRun({
        objective: 'Ship',
        coordinatorHandle: 'term_coord',
        coordinatorPaneKey: null
      }).id
      const link = openRemoteRunLink(earlier, runId, SERVER)
      for (const table of ['remote_placements', 'remote_dispatches']) {
        for (const column of ['handle', 'pane_key', 'orca_session_id']) {
          earlier.db.exec(`ALTER TABLE ${table} DROP COLUMN started_by_${column}`)
        }
      }
      earlier.db.exec(`INSERT INTO tasks (id, run_id, spec, status, created_by_terminal_handle)
        VALUES ('task_old', '${runId}', 'old', 'dispatched', 'term_coord')`)
      earlier.db.exec(`INSERT INTO remote_placements (task_id, run_id, environment_id,
        conversation_id, state, request_key, prior_task_status)
        VALUES ('task_old', '${runId}', 'env_b', '${link.conversation_id}', 'reserved', 'k_old', 'pending')`)
      earlier.close()

      const reopened = new OrchestrationDb(dbPath)
      try {
        reserveRemotePlacement(reopened, {
          link,
          taskId: 'task_new',
          requestKey: 'k_new',
          create: { spec: 'new', createdByTerminalHandle: 'term_coord' },
          startedBy: OTHER
        })
        expect(countReservedRemoteStartsCreatedBy(reopened, COORD)).toBe(1)
        expect(countReservedRemoteStartsCreatedBy(reopened, OTHER)).toBe(1)
      } finally {
        reopened.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
