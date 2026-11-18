import type { RuntimeClient } from '../runtime/client'
import { callDesktop } from './desktop-rpc'

type RunEvent = { stream: 'stdout' | 'stderr'; data: string }
type RunRead = { events: RunEvent[]; cursor: number; exit?: number }

type OutputStream = {
  write(text: string): boolean
  once?(event: 'drain' | 'close' | 'error', listener: () => void): unknown
  off?(event: 'drain' | 'close' | 'error', listener: () => void): unknown
}

export type DesktopRunIo = {
  signals: Pick<NodeJS.EventEmitter, 'on' | 'off'>
  stdout: OutputStream
  stderr: OutputStream
}

const READ_WAIT_MS = 20_000
// Above the server's longest long poll (25 s), so a slow read is not cut short.
const READ_TIMEOUT_MS = 60_000
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const

/**
 * Waits for a full pipe to drain so a slow reader holds back the program instead of memory;
 * an interrupt ends the wait, and the listeners go once it settles.
 */
async function write(stream: OutputStream, text: string, interrupt: AbortSignal): Promise<void> {
  if (stream.write(text) || !stream.once || interrupt.aborted) {
    return
  }
  await new Promise<void>((resolve) => {
    const settle = (): void => {
      for (const event of ['drain', 'close', 'error'] as const) {
        stream.off?.(event, settle)
      }
      interrupt.removeEventListener('abort', settle)
      resolve()
    }
    for (const event of ['drain', 'close', 'error'] as const) {
      stream.once?.(event, settle)
    }
    interrupt.addEventListener('abort', settle, { once: true })
  })
}

/**
 * Starts `argv` on the desktop and relays its output until it exits; resolves with the exit code
 * to leave with. SIGINT/SIGTERM kill the program on the desktop before the CLI exits.
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
  io: DesktopRunIo = { signals: process, stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  let runId: string | undefined
  let interrupted: number | undefined
  const interrupt = new AbortController()
  let killed: Promise<unknown> | undefined
  const kill = (): void => {
    if (runId !== undefined && killed === undefined) {
      killed = callDesktop(client, 'desktop.run.kill', { runId }).catch(() => {})
    }
  }
  const handlers = Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => {
    const handler = (): void => {
      interrupted ??= code
      interrupt.abort()
      kill()
    }
    io.signals.on(signal, handler)
    return () => io.signals.off(signal, handler)
  })
  try {
    // A paired server has its own filesystem: there the launcher's default directory applies.
    const started = await callDesktop<{ runId: string }>(client, 'desktop.run.start', {
      argv,
      ...(client.isRemote ? {} : { cwd })
    })
    runId = started.result.runId
    let cursor = 0
    while (interrupted === undefined) {
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
        if (interrupted !== undefined) {
          break
        }
        throw error
      }
      for (const event of read.events) {
        if (interrupted !== undefined) {
          break
        }
        await (json
          ? write(io.stdout, `${JSON.stringify(event)}\n`, interrupt.signal)
          : write(event.stream === 'stderr' ? io.stderr : io.stdout, event.data, interrupt.signal))
      }
      if (interrupted !== undefined) {
        break
      }
      cursor = read.cursor
      if (read.exit !== undefined) {
        if (json) {
          await write(io.stdout, `${JSON.stringify({ exit: read.exit })}\n`, interrupt.signal)
        }
        return read.exit
      }
    }
    kill()
    await killed
    return interrupted ?? 1
  } finally {
    for (const remove of handlers) {
      remove()
    }
  }
}
