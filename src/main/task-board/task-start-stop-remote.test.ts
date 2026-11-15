import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ORCA_SESSION_ADDRESS_PREFIX,
  parseOrcaSessionAddress
} from '../../shared/orca-session-address'
import { WorkerStartParams } from '../../shared/rpc-contract/orchestration-worker-start-params'
import {
  ensureRemoteDispatchRecord,
  recordRemoteDispatchState
} from '../runtime/orchestration/db/remote-owned/remote-dispatch-records'
import { countReservedRemoteStartsCreatedBy } from '../runtime/orchestration/db/remote-owned/remote-owned-creator-listing'
import {
  recordRemoteStart,
  reserveRemotePlacement
} from '../runtime/orchestration/db/remote-owned/remote-placements'
import { openRemoteRunLink } from '../runtime/orchestration/db/remote-owned/remote-run-links'
import { callRemoteOwnedServer } from '../runtime/orchestration/federation/remote-owned/remote-owned-calls'
import { startRemoteOwnedWorker } from '../runtime/orchestration/federation/remote-owned/remote-owned-start'
import { stopRemoteWorker } from '../runtime/orchestration/federation/remote-owned/remote-owned-stop'
import { stopTaskStartRun } from './task-start-stop'
import { listTaskStartWorkers, stopTaskStartWorker } from './task-start-stop-deps'
import {
  CARD,
  createWorker,
  h,
  OTHER_PANE,
  stopHarness,
  stopped
} from './task-start-stop.test-support'

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

/** A start `startedBy` sent for a new Task in `runId`, reserved there; `answer` records its worker. */
function reserveStart(
  runId: string,
  key: string,
  startedBy: Parameters<typeof listTaskStartWorkers>[1]
) {
  const link = openRemoteRunLink(h.db, runId, SERVER)
  const taskId = `task_${key}`
  reserveRemotePlacement(h.db, {
    link,
    taskId,
    requestKey: key,
    create: { spec: 'remote subtask' },
    startedBy
  })
  return (dispatchId: string) =>
    recordRemoteStart(h.db, {
      conversationId: link.conversation_id,
      taskId,
      dispatchId,
      requestKey: key
    })
}

function chat(id: string) {
  const orcaSessionId = parseOrcaSessionAddress(`${ORCA_SESSION_ADDRESS_PREFIX}${id}`)
  return { terminalHandle: null, paneKey: null, orcaSessionId }
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

  it('attributes a server-owned worker to the coordinator that started it, not the Task creator', async () => {
    const { firstRun } = stopHarness()
    vi.spyOn(h.runtime, 'resolveOrchestrationWorkerServer').mockReturnValue(SERVER)
    vi.spyOn(h.runtime, 'ensureOrchestrationFederationRelay').mockImplementation(() => {})
    vi.spyOn(h.runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? h.coordinatorPaneKey : handle === 'term_other' ? OTHER_PANE : null
    )
    const ours = {
      terminalHandle: 'term_coord',
      paneKey: h.coordinatorPaneKey,
      orcaSessionId: null
    }
    const theirs = { terminalHandle: 'term_other', paneKey: OTHER_PANE, orcaSessionId: null }
    // A Task term_coord created in the Run term_other then takes over and starts on the server.
    const task = h.db.createTask({
      runId: firstRun,
      spec: 'remote subtask',
      createdByTerminalHandle: 'term_coord',
      createdByPaneKey: h.coordinatorPaneKey
    })
    h.db.bindRun({
      runId: firstRun,
      coordinatorHandle: 'term_other',
      coordinatorPaneKey: OTHER_PANE
    })
    const start = (params: Record<string, string>, dispatchId: string) => {
      vi.mocked(callRemoteOwnedServer).mockResolvedValueOnce({ dispatchId, agent: 'claude' })
      return startRemoteOwnedWorker(
        h.runtime,
        WorkerStartParams.parse({ on: 'linux-box', ...params }),
        { runtime: h.runtime },
        `request-${dispatchId}`
      )
    }
    await start({ task: task.id, from: 'term_other' }, 'ctx_theirs')
    h.db.bindRun({
      runId: firstRun,
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: h.coordinatorPaneKey
    })
    await start({ spec: 'remote subtask', from: 'term_coord' }, 'ctx_ours')

    expect(listTaskStartWorkers(h.db, ours)).toContain('ctx_ours')
    expect(listTaskStartWorkers(h.db, ours)).not.toContain('ctx_theirs')
    expect(listTaskStartWorkers(h.db, theirs)).toContain('ctx_theirs')
    expect(listTaskStartWorkers(h.db, theirs)).not.toContain('ctx_ours')
  })

  it('lists a chat only the server-owned workers it started, bound to the Run or not', () => {
    h.setup()
    h.db.bindRun({
      runId: h.activeRunId,
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: chat('chat_aaaaaaaa').orcaSessionId
    })
    reserveStart(h.activeRunId, 'theirs', chat('chat_bbbbbbbb'))('ctx_theirs')
    reserveStart(h.activeRunId, 'ours', chat('chat_aaaaaaaa'))('ctx_ours')

    expect(listTaskStartWorkers(h.db, chat('chat_aaaaaaaa'))).toEqual(['ctx_ours'])
    expect(listTaskStartWorkers(h.db, chat('chat_bbbbbbbb'))).toEqual(['ctx_theirs'])
  })

  it('stays unproven when a waiting start is answered after the last listing', async () => {
    let lateLocal: string | undefined
    let answer!: (dispatchId: string) => unknown
    const { store, deps, run, secondRun } = stopHarness({
      // A worker inserted during the probe makes the second pass stop it, and the server answers then.
      onProbe: () => {
        lateLocal ??= createWorker(secondRun)
      },
      receipt: (id) => {
        if (id === lateLocal) {
          answer('ctx_late')
        }
        return stopped(id)
      }
    })
    answer = reserveStart(secondRun, 'late', {
      terminalHandle: 'term_coord',
      paneKey: h.coordinatorPaneKey,
      orcaSessionId: null
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })
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
