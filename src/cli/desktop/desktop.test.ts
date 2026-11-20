import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()
const target = vi.hoisted(() => ({ remote: false }))

vi.mock('../runtime/client', () => {
  class RuntimeClient {
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()
    get isRemote() {
      return target.remote
    }
  }
  return { RuntimeClient }
})

import { main } from '../index'
import { HANDLER_GROUPS } from '../dispatch/handler-group-manifest'
import type { RuntimeClient } from '../runtime/client'
import { RuntimeRpcFailureError } from '../runtime/connection/types'
import { okFixture } from '../runtime/fixtures/runtime-rpc-fixtures'
import { DESKTOP_COMMAND_SPECS } from '../specs/desktop'
import { DESKTOP_HANDLERS, recordingChatMarkdown } from './desktop'
import { runDesktopRun } from './desktop-run-command'

function failure(code: string, message: string): RuntimeRpcFailureError {
  return new RuntimeRpcFailureError({
    id: 'req',
    ok: false,
    error: { code, message },
    _meta: { runtimeId: 'runtime-1' }
  })
}

/** A client whose reads return `reads` in order, then wait until a kill ends the run. */
function fakeRunClient(calls: string[], reads: unknown[]): RuntimeClient {
  let releaseRead = (): void => {}
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: runDesktopRun only calls client.call, which this fake answers with RPC envelopes.
  return {
    isRemote: false,
    call: async (method: string) => {
      calls.push(method)
      if (method === 'desktop.run.start') {
        return okFixture('req', { runId: 'run-f' })
      }
      if (method === 'desktop.run.kill') {
        releaseRead()
        return okFixture('req', { killed: true })
      }
      const next = reads.shift()
      if (next !== undefined) {
        return okFixture('req', next)
      }
      await new Promise<void>((resolve) => {
        releaseRead = resolve
      })
      throw failure('desktop_run_not_found', 'No desktop run with that id.')
    }
  } as unknown as RuntimeClient
}

function logged(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => String(call[0]))
    .join('\n')
}

describe('orca desktop', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = undefined
    target.remote = false
  })

  it('desktop click calls desktop.click with numbers parsed from flags', async () => {
    callMock.mockResolvedValueOnce(okFixture('req', { state: 'ready', owner: 'agent' }))

    await main(
      ['desktop', 'click', '--x', '120', '--y', '45', '--button', 'right', '--double'],
      '/work'
    )

    expect(callMock).toHaveBeenCalledWith('desktop.click', {
      x: 120,
      y: 45,
      button: 'right',
      double: true
    })
    expect(process.exitCode).toBeUndefined()
  })

  it('desktop record stop prints the chat markdown line', async () => {
    callMock.mockResolvedValueOnce(
      okFixture('req', {
        id: 'abc',
        path: '/home/agent/.orca/desktop-recordings/rec-abc.mp4',
        seconds: 12,
        bytes: 2048,
        stopped: 'requested'
      })
    )

    await main(['desktop', 'record', 'stop'], '/work')

    expect(callMock).toHaveBeenCalledWith('desktop.record.stop', {})
    expect(logged().split('\n').at(-1)).toBe(
      '![Gravação do teste](</home/agent/.orca/desktop-recordings/rec-abc.mp4>)'
    )
  })

  it('desktop_user_in_control is printed as a clear error and exits non-zero', async () => {
    callMock.mockRejectedValueOnce(
      failure('desktop_user_in_control', 'The user has taken control of the desktop.')
    )

    await main(['desktop', 'type', '--text', 'hello'], '/work')

    const printed = vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .join('\n')
    expect(printed).toContain('The user has taken control of the desktop.')
    expect(printed).toContain('Wait for the user to hand control back.')
    expect(process.exitCode).toBe(1)
  })

  it('desktop run forwards output and exits with the command exit code', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    callMock
      .mockResolvedValueOnce(okFixture('req', { runId: 'run-a' }))
      .mockResolvedValueOnce(
        okFixture('req', {
          events: [
            { stream: 'stdout', data: 'out\n' },
            { stream: 'stderr', data: 'err\n' }
          ],
          cursor: 2
        })
      )
      .mockResolvedValueOnce(okFixture('req', { events: [], cursor: 2, exit: 7 }))

    await main(['desktop', 'run', '--', 'npm', 'run', '--watch', 'dev'], '/work/repo')

    expect(callMock.mock.calls[0]).toEqual([
      'desktop.run.start',
      { argv: ['npm', 'run', '--watch', 'dev'], cwd: '/work/repo' }
    ])
    expect(callMock.mock.calls[1]?.[1]).toEqual({ runId: 'run-a', cursor: 0, waitMs: 20_000 })
    expect(callMock.mock.calls[2]?.[1]).toEqual({ runId: 'run-a', cursor: 2, waitMs: 20_000 })
    expect(stdout).toHaveBeenCalledWith('out\n')
    expect(stderr).toHaveBeenCalledWith('err\n')
    expect(process.exitCode).toBe(7)
  })

  it('desktop run kills the run on SIGINT', async () => {
    const signals = new EventEmitter()
    let releaseRead = (): void => {}
    const calls: [string, unknown][] = []
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: runDesktopRun only calls client.call, which this fake answers with RPC envelopes.
    const client = {
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        if (method === 'desktop.run.start') {
          return okFixture('req', { runId: 'run-b' })
        }
        if (method === 'desktop.run.kill') {
          releaseRead()
          return okFixture('req', { killed: true })
        }
        // The read the kill interrupts: the server then no longer knows the run.
        await new Promise<void>((resolve) => {
          releaseRead = resolve
        })
        throw failure('desktop_run_not_found', 'No desktop run with that id.')
      }
    } as unknown as RuntimeClient
    const out = { write: vi.fn(() => true) }
    const exit = vi.fn()

    const running = runDesktopRun(
      { client, argv: ['hang'], cwd: '/work', json: false },
      { signals, stdout: out, stderr: out, exit }
    )
    await vi.waitFor(() => expect(calls.map(([method]) => method)).toContain('desktop.run.read'))
    signals.emit('SIGINT')
    const exitCode = await running

    expect(calls).toContainEqual(['desktop.run.kill', { runId: 'run-b' }])
    expect(exitCode).toBe(130)
    expect(exit).toHaveBeenCalledWith(130)
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('the chat line stays a valid Markdown destination for spaces, parentheses and angle brackets', () => {
    expect(recordingChatMarkdown('/rec/my test (1)<x>.mp4')).toBe(
      '![Gravação do teste](</rec/my test (1)\\<x\\>.mp4>)'
    )
  })

  it('resolves --out and sends cwd only when the CLI targets the local runtime', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const shot = okFixture('req', { path: '/p.png', width: 1, height: 1 })
    callMock
      .mockResolvedValueOnce(shot)
      .mockResolvedValueOnce(shot)
      .mockResolvedValueOnce(okFixture('req', { runId: 'run-r' }))
      .mockResolvedValueOnce(okFixture('req', { events: [], cursor: 0, exit: 0 }))

    await main(['desktop', 'screenshot', '--out', 'shots/a.png'], '/work')
    target.remote = true
    await main(['desktop', 'screenshot', '--out', 'shots/a.png'], '/work')
    await main(['desktop', 'run', '--', 'xterm'], '/work')

    expect(callMock.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['desktop.screenshot', { out: '/work/shots/a.png' }],
      ['desktop.screenshot', { out: 'shots/a.png' }],
      ['desktop.run.start', { argv: ['xterm'] }],
      ['desktop.run.read', { runId: 'run-r', cursor: 0, waitMs: 20_000 }]
    ])
  })

  it('desktop run exits on SIGINT while its output is blocked', async () => {
    const signals = new EventEmitter()
    const calls: string[] = []
    const client = fakeRunClient(calls, [
      { events: [{ stream: 'stdout', data: 'x' }], cursor: 1 },
      { events: [{ stream: 'stdout', data: 'never' }], cursor: 2 }
    ])
    // A pipe nobody reads: every write reports full and no drain ever comes.
    const stdout = Object.assign(new EventEmitter(), { write: vi.fn(() => false) })
    const exit = vi.fn()

    const running = runDesktopRun(
      { client, argv: ['flood'], cwd: '/work', json: false },
      { signals, stdout, stderr: stdout, exit }
    )
    await vi.waitFor(() => expect(stdout.write).toHaveBeenCalled())
    signals.emit('SIGINT')
    const exitCode = await running

    expect(exitCode).toBe(130)
    expect(exit).toHaveBeenCalledWith(130)
    expect(calls).toContain('desktop.run.kill')
    expect(stdout.write).toHaveBeenCalledTimes(1)
    // The error handler stays: a write still pending may yet fail with EPIPE.
    expect(['drain', 'close', 'error'].map((name) => stdout.listenerCount(name))).toEqual([0, 0, 1])
  })

  it('desktop run exits 130, not the program code, when SIGINT interrupts the final JSON write', async () => {
    const signals = new EventEmitter()
    const calls: string[] = []
    const client = fakeRunClient(calls, [{ events: [], cursor: 0, exit: 7 }])
    const stdout = Object.assign(new EventEmitter(), { write: vi.fn(() => false) })
    const exit = vi.fn()

    const running = runDesktopRun(
      { client, argv: ['report'], cwd: '/work', json: true },
      { signals, stdout, stderr: stdout, exit }
    )
    await vi.waitFor(() => expect(stdout.write).toHaveBeenCalledWith('{"exit":7}\n'))
    signals.emit('SIGINT')

    expect(await running).toBe(130)
    expect(exit).toHaveBeenCalledWith(130)
    expect(calls).toContain('desktop.run.kill')
  })

  it('desktop run leaves no stream listeners behind across repeated backpressure', async () => {
    const signals = new EventEmitter()
    const event = { stream: 'stdout', data: 'x' }
    const client = fakeRunClient(
      [],
      [
        { events: [event, event], cursor: 2 },
        { events: [event, event], cursor: 4 },
        { events: [event], cursor: 5, exit: 3 }
      ]
    )
    const stdout = Object.assign(new EventEmitter(), {
      write: vi.fn(() => {
        setImmediate(() => stdout.emit('drain'))
        return false
      })
    })

    const exit = vi.fn()

    const exitCode = await runDesktopRun(
      { client, argv: ['flood'], cwd: '/work', json: false },
      { signals, stdout, stderr: stdout, exit }
    )

    expect(exitCode).toBe(3)
    expect(exit).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledTimes(5)
    expect(['drain', 'close', 'error'].map((name) => stdout.listenerCount(name))).toEqual([0, 0, 1])
  })

  it('every desktop command spec has a handler and a manifest route', () => {
    const specKeys = DESKTOP_COMMAND_SPECS.map((spec) => spec.path.join(' ')).sort()
    const group = HANDLER_GROUPS.find((entry) => entry.name === 'desktop')

    expect(Object.keys(DESKTOP_HANDLERS).sort()).toEqual(specKeys)
    expect([...(group?.keys ?? [])].sort()).toEqual(specKeys)
    expect(specKeys).toEqual(
      [
        'desktop status',
        'desktop screenshot',
        'desktop move',
        'desktop click',
        'desktop drag',
        'desktop scroll',
        'desktop type',
        'desktop key',
        'desktop run',
        'desktop record start',
        'desktop record stop',
        'desktop recordings'
      ].sort()
    )
  })
})
