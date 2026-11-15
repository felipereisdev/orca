import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerStartParams } from '../../shared/rpc-contract/orchestration-worker-start-params'
import {
  ensureRemoteDispatchRecord,
  recordRemoteDispatchState
} from '../runtime/orchestration/db/remote-owned/remote-dispatch-records'
import { countReservedRemoteStartsCreatedBy } from '../runtime/orchestration/db/remote-owned/remote-owned-creator-listing'
import { openRemoteRunLink } from '../runtime/orchestration/db/remote-owned/remote-run-links'
import { callRemoteOwnedServer } from '../runtime/orchestration/federation/remote-owned/remote-owned-calls'
import { startRemoteOwnedWorker } from '../runtime/orchestration/federation/remote-owned/remote-owned-start'
import { stopRemoteWorker } from '../runtime/orchestration/federation/remote-owned/remote-owned-stop'
import { stopTaskStartRun } from './task-start-stop'
import { stopTaskStartWorker } from './task-start-stop-deps'
import { CARD, h, OTHER_PANE, stopHarness, stopped } from './task-start-stop.test-support'

vi.mock('../runtime/orchestration/federation/remote-owned/remote-owned-calls', async (actual) => ({
  ...(await actual<object>()),
  callRemoteOwnedServer: vi.fn()
}))
vi.mock('../runtime/orchestration/federation/remote-owned/remote-owned-stop', async (actual) => ({
  ...(await actual<object>()),
  stopRemoteWorker: vi.fn(async () => ({ state: 'stop_requested' }))
}))

const SERVER = { environmentId: 'env_linux', name: 'linux-box', peerFingerprint: 'linux_fp' }
const COORDINATOR = { handle: 'term_coord', paneKey: () => h.coordinatorPaneKey }

/** A worker a server owns for `runId`, for a Task `handle` created. */
function remoteWorker(runId: string, dispatchId: string, handle = COORDINATOR.handle) {
  const link = openRemoteRunLink(h.db, runId, SERVER)
  const task = h.db.createTask({
    runId,
    spec: 'remote subtask',
    createdByTerminalHandle: handle,
    createdByPaneKey: handle === COORDINATOR.handle ? COORDINATOR.paneKey() : OTHER_PANE
  })
  ensureRemoteDispatchRecord(h.db, link, { dispatchId, taskId: task.id })
  return link
}

const unproven = (dispatchId: string) => ({
  dispatchId,
  state: 'stop_requested',
  alreadySettled: false,
  processAction: 'none'
})

describe('stopTaskStartRun with workers a server owns', () => {
  afterEach(() => {
    h.cleanup()
    vi.clearAllMocks()
  })

  it('refuses a start on that server once the stop has begun', async () => {
    let refusal: unknown
    const { deps } = stopHarness({
      onClose: async () => {
        refusal = await startRemoteOwnedWorker(
          h.runtime,
          WorkerStartParams.parse({ spec: 'remote subtask', from: 'term_coord', on: 'linux-box' }),
          { runtime: h.runtime },
          undefined
        ).catch((error: unknown) => error)
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(refusal).toMatchObject({ code: 'coordinator_stopped' })
  })

  it('keeps the run stopping while a worker it created in an earlier Run is unproven', async () => {
    const { store, deps, calls, run, firstRun } = stopHarness({
      receipt: (id) => (id === 'ctx_remote' ? unproven(id) : stopped(id))
    })
    remoteWorker(firstRun, 'ctx_remote')

    await stopTaskStartRun(CARD, deps, undefined)

    expect(calls).toContain('ctx_remote')
    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })
  })

  it('leaves the workers of a coordinator that took over one of its Runs', async () => {
    const { store, deps, calls, run, firstRun } = stopHarness()
    h.db.bindRun({
      runId: firstRun,
      coordinatorHandle: 'term_other',
      coordinatorPaneKey: OTHER_PANE
    })
    remoteWorker(firstRun, 'ctx_theirs', 'term_other')
    // Then it moves on, leaving that Run bound to nobody, as the first coordinator left it.
    const third = h.db.createRun({
      objective: 'Third Run',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    }).id
    h.db.bindRun({ runId: third, coordinatorHandle: 'term_other', coordinatorPaneKey: OTHER_PANE })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(calls).not.toContain('ctx_theirs')
    expect(store.getById(run.id)?.state).toBe('stopped')
  })

  it('counts a start still waiting on the server as unproven, and stops its late worker', async () => {
    let answer!: (receipt: unknown) => void
    vi.mocked(callRemoteOwnedServer).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    const { store, deps, run } = stopHarness()
    vi.spyOn(h.runtime, 'resolveOrchestrationWorkerServer').mockReturnValue(SERVER)
    vi.spyOn(h.runtime, 'ensureOrchestrationFederationRelay').mockImplementation(() => {})
    const coordinator = {
      terminalHandle: 'term_coord',
      paneKey: h.coordinatorPaneKey,
      orcaSessionId: null
    }
    const start = startRemoteOwnedWorker(
      h.runtime,
      WorkerStartParams.parse({ spec: 'remote subtask', from: 'term_coord', on: 'linux-box' }),
      { runtime: h.runtime },
      'request-1'
    ).catch((error: unknown) => error)
    await vi.waitFor(() => expect(countReservedRemoteStartsCreatedBy(h.db, coordinator)).toBe(1))

    await stopTaskStartRun(CARD, deps, undefined)
    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })

    answer({ dispatchId: 'ctx_late', state: 'ready', agent: 'claude' })
    expect(await start).toMatchObject({ code: 'coordinator_stopped' })
    expect(vi.mocked(stopRemoteWorker).mock.calls.map((call) => call[2])).toEqual(['ctx_late'])
  })

  it('proves a server-owned worker only once the server reported it ended', async () => {
    h.setup()
    const link = remoteWorker(h.activeRunId, 'ctx_remote')
    h.db.db
      .prepare(`UPDATE remote_run_links SET state = 'closed' WHERE conversation_id = ?`)
      .run(link.conversation_id)

    expect(await stopTaskStartWorker(h.runtime, 'ctx_remote', undefined)).not.toMatchObject({
      state: 'stopped'
    })
    recordRemoteDispatchState(h.db, 'ctx_remote', {
      status: 'completed',
      worker_state: 'stopped',
      last_failure: null,
      agent: null
    })
    expect(await stopTaskStartWorker(h.runtime, 'ctx_remote', undefined)).toMatchObject({
      state: 'stopped'
    })
    expect(stopRemoteWorker).not.toHaveBeenCalled()
  })
})
