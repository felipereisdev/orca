import type { RuntimeClient } from '../runtime/client'
import { callDesktop } from './desktop-rpc'

type RunEvent = { stream: 'stdout' | 'stderr'; data: string }
type RunRead = { events: RunEvent[]; cursor: number; exit?: number }

type OutputStream = {
  write(text: string): boolean
  on?(event: 'error', listener: () => void): unknown
  once?(event: 'drain' | 'close', listener: () => void): unknown
  off?(event: 'drain' | 'close', listener: () => void): unknown
}

export type DesktopRunIo = {
  signals: Pick<NodeJS.EventEmitter, 'on' | 'off'>
  stdout: OutputStream
  stderr: OutputStream
  /** Ends the process after a signal; writes still pending are dropped. */
  exit: (code: number) => void
}

const READ_WAIT_MS = 20_000
// Above the server's longest long poll (25 s), so a slow read is not cut short.
const READ_TIMEOUT_MS = 60_000
const KILL_WAIT_MS = 2_000
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const

const ignoreStreamError = (): void => {}

/**
 * Waits for a full pipe to drain so a slow reader holds back the program instead of memory.
 * An interrupt ends the wait; the drain/close listeners go once it settles.
 */
async function write(stream: OutputStream, text: string, interrupt: AbortSignal): Promise<void> {
  if (stream.write(text) || !stream.once || interrupt.aborted) {
    return
  }
  await new Promise<void>((resolve) => {
    const settle = (): void => {
      stream.off?.('drain', settle)
      stream.off?.('close', settle)
      interrupt.removeEventListener('abort', settle)
      resolve()
    }
    stream.once?.('drain', settle)
    stream.once?.('close', settle)
    interrupt.addEventListener('abort', settle, { once: true })
  })
}

const pause = (ms: number): { done: Promise<void>; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  return { done, cancel: () => clearTimeout(timer) }
}

/**
 * Starts `argv` on the desktop and relays its output until it exits; resolves with the exit code
 * to leave with. Once SIGINT/SIGTERM arrives that path wins: the program is killed on the desktop
 * (waiting at most 2 s) and the process exits with 130/143, dropping any write still pending.
 */
export async function runDesktopRun(
  {
    client,
    argv,
    cwd,
    json
  }: {
    client: Pick<RuntimeClient, 'call' | 'isRemote'>
    argv: string[]
    cwd: string
    json: boolean
  },
  io: DesktopRunIo = {
    signals: process,
    stdout: process.stdout,
    stderr: process.stderr,
    exit: (code) => process.exit(code)
  }
): Promise<number> {
  // Permanent: a write left pending by an interrupt may still fail with EPIPE.
  for (const stream of new Set([io.stdout, io.stderr])) {
    stream.on?.('error', ignoreStreamError)
  }
  const interrupt = new AbortController()
  let resolveStarted = (_runId: string | undefined): void => {}
  const started = new Promise<string | undefined>((resolve) => {
    resolveStarted = resolve
  })
  let interrupted: Promise<number> | undefined
  const onSignal = (code: number): void => {
    if (interrupted) {
      return
    }
    interrupt.abort()
    interrupted = (async () => {
      const deadline = pause(KILL_WAIT_MS)
      const kill = (async () => {
        const runId = await started
        if (runId !== undefined) {
          await callDesktop(client, 'desktop.run.kill', { runId }, { timeoutMs: KILL_WAIT_MS })
        }
      })().catch(() => {})
      await Promise.race([kill, deadline.done])
      deadline.cancel()
      io.exit(code)
      return code
    })()
  }
  const removers = Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => {
    const handler = (): void => onSignal(code)
    io.signals.on(signal, handler)
    return () => io.signals.off(signal, handler)
  })
  try {
    let runId: string
    try {
      // A paired server has its own filesystem: there the launcher's default directory applies.
      const reply = await callDesktop<{ runId: string }>(client, 'desktop.run.start', {
        argv,
        ...(client.isRemote ? {} : { cwd })
      })
      runId = reply.result.runId
    } catch (error) {
      resolveStarted(undefined)
      if (interrupted) {
        return await interrupted
      }
      throw error
    }
    resolveStarted(runId)
    let cursor = 0
    while (!interrupted) {
      let read: RunRead
      try {
        read = (
          await callDesktop<RunRead>(
            client,
            'desktop.run.read',
            { runId, cursor, waitMs: READ_WAIT_MS },
            { timeoutMs: READ_TIMEOUT_MS }
          )
        ).result
      } catch (error) {
        // The kill ends the read in flight; that failure is the interruption itself.
        if (interrupted) {
          break
        }
        throw error
      }
      for (const event of read.events) {
        if (interrupted) {
          break
        }
        await (json
          ? write(io.stdout, `${JSON.stringify(event)}\n`, interrupt.signal)
          : write(event.stream === 'stderr' ? io.stderr : io.stdout, event.data, interrupt.signal))
      }
      cursor = read.cursor
      if (!interrupted && read.exit !== undefined) {
        if (json) {
          await write(io.stdout, `${JSON.stringify({ exit: read.exit })}\n`, interrupt.signal)
        }
        if (!interrupted) {
          return read.exit
        }
      }
    }
    return await (interrupted ?? Promise.resolve(1))
  } finally {
    for (const remove of removers) {
      remove()
    }
  }
}
