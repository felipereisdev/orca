import { afterEach, describe, expect, it, vi } from 'vitest'
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
  type DesktopReply
} from './desktop-methods-test-harness'

const TOKEN = 'launcher-token-5d8e1b7a0c3f49e2a6b1c9d4e7f0a2b3'

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

function setup() {
  const harness = createDesktopRpcHarness()
  cleanups.push(() => harness.broker.close())
  return harness
}

const results = (replies: DesktopReply[]) => replies.map((reply) => reply.result)
const outputChars = (replies: DesktopReply[]) =>
  replies.reduce((total, reply) => total + String(reply.result?.stdout ?? '').length, 0)
const hasExit = (replies: DesktopReply[]) =>
  replies.some((reply) => reply.result?.exit !== undefined)
const MiB = 1024 * 1024
const hasStdout = (text: string) => (replies: DesktopReply[]) =>
  replies.some((reply) => reply.result?.stdout === text)

describe('desktop.run', () => {
  it('streams output and exit code from the launcher', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const { configure, stream } = setup()
    await configure(vnc, MAC, { port: launcher.port, token: TOKEN })

    const echo = stream('desktop.run', { argv: ['echo', 'hello', 'world'] }, MAC_AGENT)
    await echo.done
    const failing = stream('desktop.run', { argv: ['fail', '3', 'boom'] }, LOCAL_AGENT)
    await failing.done
    const report = stream(
      'desktop.run',
      { argv: ['report'], cwd: '/work/repo', env: { NODE_ENV: 'test' } },
      MAC_AGENT
    )
    await report.done

    expect(results(echo.replies)).toEqual([
      { type: 'ready', subscriptionId: expect.stringMatching(/^desktop-run:/) },
      { stdout: 'hello world\n' },
      { exit: 0 }
    ])
    expect(results(failing.replies).slice(1)).toEqual([{ stderr: 'boom\n' }, { exit: 3 }])
    expect(launcher.runs[2]).toEqual({
      id: 'run-3',
      argv: ['report'],
      cwd: '/work/repo',
      env: { NODE_ENV: 'test' }
    })
  })

  it('without a launcher returns desktop_run_unavailable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc } = await servers()
    const { configure, stream } = setup()

    const unconfigured = stream('desktop.run', { argv: ['echo', 'hi'] }, MAC_AGENT)
    await unconfigured.done
    await configure(vnc, MAC)
    const noLauncher = stream('desktop.run', { argv: ['echo', 'hi'] }, MAC_AGENT)
    await noLauncher.done

    for (const run of [unconfigured, noLauncher]) {
      expect(run.replies).toMatchObject([{ ok: false, error: { code: 'desktop_run_unavailable' } }])
    }
  })

  it('the launcher token never appears in run output, errors or status', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const { call, configure, stream } = setup()
    const wrongToken = 'wrong-token-0f9e8d7c6b5a49382716f5e4d3c2b1a0'

    await configure(vnc, MAC, { port: launcher.port, token: TOKEN })
    const report = stream('desktop.run', { argv: ['report'], env: { A: '1' } }, MAC_AGENT)
    await report.done
    const unknown = stream('desktop.run', { argv: ['no-such-program'] }, MAC_AGENT)
    await unknown.done
    const status = await call('desktop.status', {}, MAC_AGENT)
    await configure(vnc, MAC, { port: launcher.port, token: wrongToken })
    const rejected = stream('desktop.run', { argv: ['echo', 'hi'] }, MAC_AGENT)
    await rejected.done

    expect(results(report.replies).at(-1)).toEqual({ exit: 0 })
    expect(unknown.replies).toMatchObject([{ ok: false, error: { code: 'desktop_run_failed' } }])
    expect(rejected.replies).toMatchObject([
      { ok: false, error: { code: 'desktop_launcher_rejected' } }
    ])
    expect(launcher.rejected).toBe(1)
    const everything = JSON.stringify([report.replies, unknown.replies, status, rejected.replies])
    expect(everything).not.toContain(TOKEN)
    expect(everything).not.toContain(wrongToken)
  })

  it('unsubscribing kills the run on the launcher', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const { call, configure, stream } = setup()
    await configure(vnc, MAC, { port: launcher.port, token: TOKEN })

    const run = stream('desktop.run', { argv: ['hang'] }, MAC_AGENT)
    await run.waitForReplies(hasStdout('started\n'))
    const subscriptionId = run.replies[0]?.result?.subscriptionId
    const stranger = await call(
      'desktop.run.unsubscribe',
      { subscriptionId },
      { ...MAC_AGENT, connectionId: 'another-connection' }
    )
    const own = await call(
      'desktop.run.unsubscribe',
      { subscriptionId },
      { ...MAC_AGENT, connectionId: run.connectionId }
    )
    await launcher.waitForClosed('run-1')
    await run.done

    expect(launcher.killed).toEqual(['run-1'])
    expect(stranger).toMatchObject({ ok: true, result: { unsubscribed: false } })
    expect(own).toMatchObject({ ok: true, result: { unsubscribed: true } })
    expect(results(run.replies).at(-1)).toEqual({ type: 'end', subscriptionId })
  })

  it('aborting the request kills the run on the launcher', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const { configure, stream } = setup()
    await configure(vnc, MAC, { port: launcher.port, token: TOKEN })
    const abort = new AbortController()

    const run = stream('desktop.run', { argv: ['hang'] }, MAC_AGENT, abort.signal)
    await run.waitForReplies(hasStdout('started\n'))
    abort.abort()
    await launcher.waitForClosed('run-1')
    await run.done

    expect(launcher.killed).toEqual(['run-1'])
    expect(results(run.replies).map((result) => result && Object.keys(result))).toEqual([
      ['type', 'subscriptionId'],
      ['stdout']
    ])
  })

  it('is refused while the user owns the desktop, before reaching the launcher', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const { broker, configure, stream } = setup()
    await configure(vnc, MAC, { port: launcher.port, token: TOKEN })
    broker.setOwner('user', 'v1')

    const run = stream('desktop.run', { argv: ['echo', 'hi'] }, MAC_AGENT)
    await run.done

    expect(run.replies).toMatchObject([{ ok: false, error: { code: 'desktop_user_in_control' } }])
    expect(launcher.connections).toBe(0)
  })

  it('stops reading the launcher while 1 MiB of output is unacknowledged', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const { call, configure, stream } = setup()
    await configure(vnc, MAC, { port: launcher.port, token: TOKEN })
    const lineChars = 64 * 1024

    const run = stream('desktop.run', { argv: ['flood', '64', String(lineChars)] }, MAC_AGENT)
    await run.waitForReplies((replies) => outputChars(replies) > MiB)
    // The launcher already wrote all 4 MiB; give the socket turns to deliver more if unpaused.
    // ast-grep-ignore: test-no-polling-loop -- fixed I/O turns, no condition polled
    for (let turn = 0; turn < 50; turn++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    const unacknowledged = outputChars(run.replies)
    const subscriptionId = run.replies[0]?.result?.subscriptionId
    const ack = (received: number) =>
      call(
        'desktop.run.ack',
        { subscriptionId, received },
        { ...MAC_AGENT, connectionId: run.connectionId }
      )
    // ast-grep-ignore: test-no-polling-loop -- each ack waits for the output it releases
    while (!hasExit(run.replies)) {
      const received = outputChars(run.replies)
      await ack(received)
      await run.waitForReplies((replies) => hasExit(replies) || outputChars(replies) > received)
    }
    await run.done

    expect(unacknowledged).toBeLessThanOrEqual(MiB + lineChars)
    expect(hasExit(run.replies)).toBe(true)
    expect(outputChars(run.replies)).toBe(64 * lineChars)
    expect(results(run.replies).at(-1)).toEqual({ exit: 0 })
  })

  it('a launcher line over 1 MiB fails the run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { vnc, launcher } = await servers()
    const { configure, stream } = setup()
    await configure(vnc, MAC, { port: launcher.port, token: TOKEN })
    const envelope = JSON.stringify({ stream: 'stdout', data: '' }).length

    const run = stream('desktop.run', { argv: ['bigline', String(MiB - envelope + 1)] }, MAC_AGENT)
    await run.done

    expect(outputChars(run.replies)).toBe(0)
    expect(run.replies.at(-1)).toMatchObject({
      ok: false,
      error: {
        code: 'desktop_run_failed',
        message: expect.stringContaining('launcher_protocol_error')
      }
    })
  })
})
