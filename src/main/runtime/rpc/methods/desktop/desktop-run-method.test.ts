import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopRunSessions } from '../../../../desktop/desktop-run-sessions'
import { FIXTURE_PASSWORD } from '../../../../desktop/testing/desktop-broker-fixture'
import {
  startFakeDesktopLauncher,
  type FakeDesktopLauncher
} from '../../../../desktop/testing/fake-desktop-launcher'
import { startFakeRfbServer, type FakeRfbServer } from '../../../../desktop/testing/fake-rfb-server'
import {
  createDesktopRpcHarness,
  LOCAL_AGENT,
  MAC,
  MAC_AGENT,
  type DesktopTestTransport
} from './desktop-methods-test-harness'

const TOKEN = 'launcher-token-5d8e1b7a0c3f49e2a6b1c9d4e7f0a2b3'
const MiB = 1024 * 1024

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function servers(): Promise<{ vnc: FakeRfbServer; launcher: FakeDesktopLauncher }> {
  const vnc = await startFakeRfbServer({ password: FIXTURE_PASSWORD, width: 64, height: 48 })
  cleanups.push(() => vnc.close())
  const launcher = await startFakeDesktopLauncher(TOKEN)
  cleanups.push(() => launcher.close())
  return { vnc, launcher }
}

async function setup(withLauncher = true) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { vnc, launcher } = await servers()
  const runSessions = new DesktopRunSessions()
  cleanups.push(() => runSessions.close())
  const harness = createDesktopRpcHarness(undefined, { runSessions })
  cleanups.push(() => harness.broker.close())
  if (withLauncher) {
    await harness.configure(vnc, MAC, { port: launcher.port, token: TOKEN })
  }
  const start = async (params: unknown, transport: DesktopTestTransport = MAC_AGENT) => {
    const reply = await harness.call('desktop.run.start', params, transport)
    return { reply, runId: String(reply.result?.runId) }
  }
  const read = (
    runId: string,
    cursor: number,
    transport: DesktopTestTransport = MAC_AGENT,
    waitMs = 0
  ) => harness.call('desktop.run.read', { runId, cursor, waitMs }, transport)
  /** Reads until the exit, acknowledging each batch with the next cursor. */
  const readAll = async (runId: string, transport: DesktopTestTransport = MAC_AGENT) => {
    const events: RunEvent[] = []
    let cursor = 0
    // ast-grep-ignore: test-no-polling-loop -- each read long-polls for the output it returns
    for (;;) {
      const reply = await read(runId, cursor, transport, 20_000)
      if (!reply.ok) {
        return { events, reply }
      }
      events.push(...replyEvents(reply))
      cursor = Number(reply.result?.cursor)
      if (reply.result?.exit !== undefined) {
        return { events, reply, exit: Number(reply.result.exit) }
      }
    }
  }
  return { vnc, launcher, runSessions, ...harness, start, read, readAll }
}

type RunEvent = { stream: string; data: string }

const isRunEvent = (value: unknown): value is RunEvent =>
  typeof value === 'object' &&
  value !== null &&
  'stream' in value &&
  typeof value.stream === 'string' &&
  'data' in value &&
  typeof value.data === 'string'

const replyEvents = (reply: { result?: Record<string, unknown> }): RunEvent[] => {
  const events = reply.result?.events
  return Array.isArray(events) ? events.filter(isRunEvent) : []
}

const ioTurns = async (turns = 50) => {
  // ast-grep-ignore: test-no-polling-loop -- fixed I/O turns, no condition polled
  for (let turn = 0; turn < turns; turn++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('desktop.run session', () => {
  it('starts, reads output and returns the exit code', async () => {
    const { launcher, start, readAll } = await setup()

    const echo = await start({ argv: ['echo', 'hello', 'world'] })
    const echoed = await readAll(echo.runId)
    const failing = await start({ argv: ['fail', '3', 'boom'] }, LOCAL_AGENT)
    const failed = await readAll(failing.runId, LOCAL_AGENT)
    const report = await start({ argv: ['report'], cwd: '/work/repo', env: { NODE_ENV: 'test' } })
    await readAll(report.runId)

    expect(echo.runId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(echoed.events).toEqual([{ stream: 'stdout', data: 'hello world\n' }])
    expect(echoed.exit).toBe(0)
    expect(echoed.reply.result?.cursor).toBe(1)
    expect(failed.events).toEqual([{ stream: 'stderr', data: 'boom\n' }])
    expect(failed.exit).toBe(3)
    expect(launcher.runs[2]).toEqual({
      id: 'run-3',
      argv: ['report'],
      cwd: '/work/repo',
      env: { NODE_ENV: 'test' }
    })
  })

  it('a read long-polls and returns as soon as output arrives or the run exits', async () => {
    const { launcher, start, read } = await setup()

    const { runId } = await start({ argv: ['hang'] })
    const first = await read(runId, 0, MAC_AGENT, 20_000)
    let settled = false
    const waiting = read(runId, 1, MAC_AGENT, 20_000).then((reply) => {
      settled = true
      return reply
    })
    await ioTurns()
    const settledBeforeOutput = settled
    launcher.emit('run-1', { stream: 'stdout', data: 'more\n' })
    const second = await waiting
    const exiting = read(runId, 2, MAC_AGENT, 20_000)
    await ioTurns()
    launcher.emit('run-1', { exit: 5 })
    const third = await exiting

    expect(first.result).toEqual({ events: [{ stream: 'stdout', data: 'started\n' }], cursor: 1 })
    expect(settledBeforeOutput).toBe(false)
    expect(second.result).toEqual({ events: [{ stream: 'stdout', data: 'more\n' }], cursor: 2 })
    expect(third.result).toEqual({ events: [], cursor: 2, exit: 5 })
  })

  it('a read with nothing new returns empty once waitMs elapses', async () => {
    const { start, read } = await setup()
    const { runId } = await start({ argv: ['hang'] })
    await read(runId, 0, MAC_AGENT, 20_000)

    const waiting = read(runId, 1, MAC_AGENT, 20_000)
    await ioTurns()
    await vi.advanceTimersByTimeAsync(20_000)

    expect((await waiting).result).toEqual({ events: [], cursor: 1 })
  })

  it('never holds more than 1 MiB of unread output, and resumes on read', async () => {
    const { start, read, runSessions } = await setup()
    const lineChars = 64 * 1024

    const { runId } = await start({ argv: ['flood', '64', String(lineChars)] })
    // The launcher already wrote all 4 MiB; give the socket turns to deliver more if unpaused.
    await ioTurns()
    const full = runSessions.bufferedCost(runId)
    const costs: number[] = []
    let cursor = 0
    let chars = 0
    let exit: unknown
    // ast-grep-ignore: test-no-polling-loop -- each read long-polls for the output it releases
    while (exit === undefined) {
      const reply = await read(runId, cursor, MAC_AGENT, 20_000)
      await ioTurns(5)
      costs.push(runSessions.bufferedCost(runId) ?? 0)
      const events = replyEvents(reply)
      chars += events.reduce((total, event) => total + event.data.length, 0)
      cursor = Number(reply.result?.cursor)
      exit = reply.result?.exit
    }

    // The 16th line only partly fits: the buffer fills to the byte.
    expect(full).toBe(MiB)
    expect(Math.max(...costs)).toBeLessThanOrEqual(MiB)
    expect(chars).toBe(64 * lineChars)
    expect(exit).toBe(0)
  })

  for (const [label, frameChars, bound] of [
    ['empty', 0, MiB],
    ['1-byte', 1, Math.floor(MiB / 257) * 257]
  ] as const) {
    it(`a flood of ${label} frames fills the budget without passing it`, async () => {
      const { start, runSessions, readAll } = await setup()
      const frames = 20_000

      const { runId } = await start({ argv: ['flood', String(frames), String(frameChars)] })
      await ioTurns()
      const full = runSessions.bufferedCost(runId)
      const all = await readAll(runId)

      expect(full).toBe(bound)
      expect(all.events).toHaveLength(frames)
      expect(all.exit).toBe(0)
    })
  }

  it('splits a frame bigger than the budget into chunks that fit', async () => {
    const { start, runSessions, readAll } = await setup()
    const envelope = JSON.stringify({ stream: 'stdout', data: '' }).length
    const chars = MiB - envelope

    const { runId } = await start({ argv: ['bigline', String(chars)] })
    await ioTurns()
    const full = runSessions.bufferedCost(runId)
    const all = await readAll(runId)

    expect(full).toBe(MiB)
    expect(all.events.map((event) => event.data.length)).toEqual([MiB - 256, chars - (MiB - 256)])
    expect(all.exit).toBe(0)
  })

  it('returns output buffered before a launcher failure, then the failure', async () => {
    const { launcher, start, read } = await setup()

    const { runId } = await start({ argv: ['hang'] })
    await read(runId, 0, MAC_AGENT, 20_000)
    launcher.emit('run-1', { stream: 'stderr', data: 'trailing\n' })
    launcher.drop('run-1')
    await launcher.waitForClosed('run-1')
    await ioTurns()
    const last = await read(runId, 1, MAC_AGENT, 20_000)
    const failed = await read(runId, 2, MAC_AGENT, 20_000)

    expect(last).toMatchObject({
      ok: true,
      result: { events: [{ stream: 'stderr', data: 'trailing\n' }], cursor: 2 }
    })
    expect(last.result?.exit).toBeUndefined()
    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: 'desktop_run_failed',
        message: expect.stringContaining('launcher_connection_lost')
      }
    })
  })

  it('admits at most the cap of pending and running runs; finished runs do not count', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const runSessions = new DesktopRunSessions({ maxActiveRuns: 2 })
    cleanups.push(() => runSessions.close())
    const harness = createDesktopRpcHarness(undefined, { runSessions })
    cleanups.push(() => harness.broker.close())
    await harness.configure(vnc, MAC, { port: launcher.port, token: TOKEN })
    const start = (argv: string[]) => harness.call('desktop.run.start', { argv }, MAC_AGENT)

    // Started together: the third is refused before the launcher answers the first two.
    const together = await Promise.all([start(['echo', 'a']), start(['hang']), start(['hang'])])
    const connectionsTogether = launcher.connections
    const echoId = String(together[0].result?.runId)
    let exit: unknown
    // ast-grep-ignore: test-no-polling-loop -- each read long-polls until the echo exits
    for (let cursor = 0; exit === undefined;) {
      const reply = await harness.call(
        'desktop.run.read',
        { runId: echoId, cursor, waitMs: 20_000 },
        MAC_AGENT
      )
      cursor = Number(reply.result?.cursor)
      exit = reply.result?.exit
    }
    const afterExit = await start(['hang'])
    const overCap = await start(['hang'])

    expect(together.map((reply) => reply.ok)).toEqual([true, true, false])
    expect(together[2]).toMatchObject({
      error: { code: 'desktop_run_unavailable', message: expect.stringContaining('too_many_runs') }
    })
    expect(connectionsTogether).toBe(2)
    expect(afterExit.ok).toBe(true)
    expect(overCap).toMatchObject({ ok: false, error: { code: 'desktop_run_unavailable' } })
  })

  it('another caller cannot read or kill a run', async () => {
    const { launcher, start, read, call } = await setup()

    const { runId } = await start({ argv: ['hang'] }, MAC_AGENT)
    const readByLocal = await read(runId, 0, LOCAL_AGENT)
    const readByPerson = await read(runId, 0, MAC)
    const killByLocal = await call('desktop.run.kill', { runId }, LOCAL_AGENT)
    const unknown = await read('no-such-run', 0, MAC_AGENT)
    const own = await read(runId, 0, MAC_AGENT, 20_000)

    for (const reply of [readByLocal, readByPerson, killByLocal, unknown]) {
      expect(reply).toMatchObject({ ok: false, error: { code: 'desktop_run_not_found' } })
    }
    expect(launcher.killed).toEqual([])
    expect(own.result?.events).toEqual([{ stream: 'stdout', data: 'started\n' }])
  })

  it('kill stops the run on the launcher and forgets it', async () => {
    const { launcher, start, read, call } = await setup()

    const { runId } = await start({ argv: ['hang'] })
    await read(runId, 0, MAC_AGENT, 20_000)
    const killed = await call('desktop.run.kill', { runId }, MAC_AGENT)
    await launcher.waitForClosed('run-1')
    const after = await read(runId, 1)

    expect(killed).toMatchObject({ ok: true, result: { killed: true } })
    expect(launcher.killed).toEqual(['run-1'])
    expect(after).toMatchObject({ ok: false, error: { code: 'desktop_run_not_found' } })
  })

  it('kills a run nobody read for 60 s', async () => {
    const { launcher, start, read } = await setup()

    const { runId } = await start({ argv: ['hang'] })
    await read(runId, 0)
    await vi.advanceTimersByTimeAsync(59_000)
    const stillThere = await read(runId, 0)
    await vi.advanceTimersByTimeAsync(59_000)
    const killedBefore = [...launcher.killed]
    await vi.advanceTimersByTimeAsync(1_000)
    await launcher.waitForClosed('run-1')
    const after = await read(runId, 0)

    expect(stillThere.ok).toBe(true)
    expect(killedBefore).toEqual([])
    expect(launcher.killed).toEqual(['run-1'])
    expect(after).toMatchObject({ ok: false, error: { code: 'desktop_run_not_found' } })
  })

  it('forgets a finished run 60 s after its exit was returned', async () => {
    const { start, read, readAll } = await setup()

    const { runId } = await start({ argv: ['echo', 'hi'] })
    await readAll(runId)
    await vi.advanceTimersByTimeAsync(59_000)
    const again = await read(runId, 1)
    await vi.advanceTimersByTimeAsync(1_000)
    const after = await read(runId, 1)

    expect(again.result).toEqual({ events: [], cursor: 1, exit: 0 })
    expect(after).toMatchObject({ ok: false, error: { code: 'desktop_run_not_found' } })
  })

  it('without a launcher returns desktop_run_unavailable', async () => {
    const { vnc, start, configure } = await setup(false)

    const unconfigured = await start({ argv: ['echo', 'hi'] })
    await configure(vnc, MAC)
    const noLauncher = await start({ argv: ['echo', 'hi'] })

    for (const run of [unconfigured, noLauncher]) {
      expect(run.reply).toMatchObject({ ok: false, error: { code: 'desktop_run_unavailable' } })
    }
  })

  it('is refused while the user owns the desktop even with no launcher configured', async () => {
    const { vnc, broker, start, configure } = await setup(false)
    await configure(vnc, MAC)
    broker.setOwner('user', 'v1')

    const run = await start({ argv: ['echo', 'hi'] })

    expect(run.reply).toMatchObject({ ok: false, error: { code: 'desktop_user_in_control' } })
  })

  it('is refused while the user owns the desktop, before reaching the launcher', async () => {
    const { launcher, broker, start } = await setup()
    broker.setOwner('user', 'v1')

    const run = await start({ argv: ['echo', 'hi'] })

    expect(run.reply).toMatchObject({ ok: false, error: { code: 'desktop_user_in_control' } })
    expect(launcher.connections).toBe(0)
  })

  it('the launcher token never appears in run output, errors or status', async () => {
    const { vnc, launcher, call, configure, start, readAll } = await setup()
    const wrongToken = 'wrong-token-0f9e8d7c6b5a49382716f5e4d3c2b1a0'

    const report = await start({ argv: ['report'], env: { A: '1' } })
    const reported = await readAll(report.runId)
    const unknown = await start({ argv: ['no-such-program'] })
    const status = await call('desktop.status', {}, MAC_AGENT)
    await configure(vnc, MAC, { port: launcher.port, token: wrongToken })
    const rejected = await start({ argv: ['echo', 'hi'] })

    expect(reported.exit).toBe(0)
    expect(unknown.reply).toMatchObject({ ok: false, error: { code: 'desktop_run_failed' } })
    expect(rejected.reply).toMatchObject({
      ok: false,
      error: { code: 'desktop_launcher_rejected' }
    })
    expect(launcher.rejected).toBe(1)
    const everything = JSON.stringify([reported, unknown, status, rejected])
    expect(everything).not.toContain(TOKEN)
    expect(everything).not.toContain(wrongToken)
  })

  it('a launcher line over 1 MiB fails the run on read', async () => {
    const { start, readAll } = await setup()
    const envelope = JSON.stringify({ stream: 'stdout', data: '' }).length

    const { runId } = await start({ argv: ['bigline', String(MiB - envelope + 1)] })
    const all = await readAll(runId)

    expect(all.events).toEqual([])
    expect(all.reply).toMatchObject({
      ok: false,
      error: {
        code: 'desktop_run_failed',
        message: expect.stringContaining('launcher_protocol_error')
      }
    })
  })

  it('rejects a waitMs over 25 s and a cursor ahead of the output', async () => {
    const { start, call } = await setup()
    const { runId } = await start({ argv: ['hang'] })

    const tooLong = await call('desktop.run.read', { runId, cursor: 0, waitMs: 25_001 }, MAC_AGENT)
    const ahead = await call('desktop.run.read', { runId, cursor: 99, waitMs: 0 }, MAC_AGENT)

    expect(tooLong).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(ahead).toMatchObject({ ok: false, error: { code: 'desktop_invalid_input' } })
  })
})
