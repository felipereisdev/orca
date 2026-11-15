import { afterEach, describe, expect, it } from 'vitest'
import { stopTaskStartRun } from './task-start-stop'
import { CARD, createWorker, h, stopHarness, stopped } from './task-start-stop.test-support'

describe('stopTaskStartRun', () => {
  afterEach(() => h.cleanup())

  it('closes the orchestrator, then stops every worker it created in any of its Runs', async () => {
    const { store, deps, calls, run, workers, secondRun } = stopHarness()
    expect(
      h.db
        .runsBoundToCoordinator({
          terminalHandle: 'term_coord',
          paneKey: h.coordinatorPaneKey,
          orcaSessionId: null
        })
        .map((bound) => bound.id)
    ).toEqual([secondRun])

    const result = await stopTaskStartRun(CARD, deps, undefined)

    expect(calls[0]).toBe('close')
    expect(calls.slice(1).sort()).toEqual([...workers].sort())
    expect(result.run?.state).toBe('stopped')
    expect(store.getById(run.id)?.state).toBe('stopped')
  })

  it('refuses a worker start from the orchestrator once the stop has begun', async () => {
    let refusal: unknown
    const { deps, calls, workers, secondRun } = stopHarness({
      onClose: async () => {
        const task = h.db.createTask({ spec: 'one more subtask', runId: secondRun })
        refusal = await h
          .call('orchestration.workerStart', { task: task.id, from: 'term_coord', agent: 'claude' })
          .then(() => 'started')
          .catch((error: unknown) => error)
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(refusal).toMatchObject({ code: 'coordinator_stopped' })
    expect(calls.slice(1).sort()).toEqual([...workers].sort())
  })

  it('stops a worker that appears after the first listing', async () => {
    let late: string | undefined
    const { store, deps, calls, run, secondRun } = stopHarness({
      onProbe: () => {
        late ??= createWorker(secondRun)
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(calls).toContain(late)
    expect(store.getById(run.id)?.state).toBe('stopped')
  })

  it('keeps the run stopping when the orchestrator names no coordinator to list', async () => {
    const { store, deps, run } = stopHarness({
      orchestrator: {
        hostId: 'local',
        agent: 'claude',
        worktreeId: 'wt-1',
        surface: 'chat',
        sessionId: 'not a session id'
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })
  })

  it('keeps the run stopping when the workers cannot be listed', async () => {
    const { store, deps, run } = stopHarness({
      liveWorkers: () => {
        throw new Error('database is locked')
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)

    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })
  })

  it('keeps the run stopping when a worker stop is unproven, and a repeat settles it', async () => {
    let proven = false
    let unproven: string | undefined
    const { store, deps, run } = stopHarness({
      receipt: (dispatchId) => {
        unproven ??= dispatchId
        return dispatchId === unproven && !proven
          ? { dispatchId, state: 'stop_unknown', alreadySettled: false, processAction: 'unknown' }
          : stopped(dispatchId)
      }
    })

    await stopTaskStartRun(CARD, deps, undefined)
    expect(store.getById(run.id)).toMatchObject({ state: 'stopping', failure: 'stop-unconfirmed' })

    proven = true
    await expect(stopTaskStartRun(CARD, deps, undefined)).resolves.toMatchObject({
      run: { state: 'stopped' }
    })
  })

  it('previews the orchestrator and the workers it created without stopping anything', async () => {
    const { store, deps, calls, run } = stopHarness()

    const result = await stopTaskStartRun(CARD, deps, undefined, { preview: true })

    expect(result.agents).toBe(4)
    expect(calls).toEqual([])
    expect(store.getById(run.id)?.state).toBe('running')
  })
})
