import { connect, type Socket } from 'node:net'
import { DesktopError } from './desktop-errors'

/**
 * JSON-lines protocol with the in-environment launcher (runs as user `desktop`), one TCP
 * connection per program:
 *   → {"token","op":"run","argv":[…],"cwd"?,"env"?}
 *   ← {"id":"<run id>"}                          started, in its own process group
 *   ← {"stream":"stdout"|"stderr","data":"…"}   any number of these
 *   ← {"exit":<code>}                            then the launcher closes (signal death: 128 + n)
 *   → {"token","op":"kill","id":"<run id>"}     kills the process group; the client then closes
 * Instead of the id, a refusal closes the connection: {"error":"bad_token"} for a wrong token,
 * {"error":"<code>"} otherwise. The launcher also kills a run whose connection closes.
 * The token goes only into request lines: never into errors, logs or events.
 */
export type LauncherEndpoint = { host: string; port: number; token: string }

export type LauncherRunRequest = { argv: string[]; cwd?: string; env?: Record<string, string> }

export type LauncherRunHandlers = {
  signal: AbortSignal
  onStarted(): void
  onOutput(stream: 'stdout' | 'stderr', data: string): void
}

const START_TIMEOUT_MS = 10_000
const KILL_FLUSH_MS = 2_000
const MAX_LINE_CHARS = 1024 * 1024

type LauncherReply = {
  id?: unknown
  error?: unknown
  stream?: unknown
  data?: unknown
  exit?: unknown
}

/** Splits a socket's text into lines without rescanning, refusing lines over the cap. */
function lineReader(onLine: (line: string) => void, onOverflow: () => void) {
  let pending: string[] = []
  let pendingChars = 0
  return (chunk: string): void => {
    const parts = chunk.split('\n')
    const last = parts.pop() ?? ''
    for (const part of parts) {
      pending.push(part)
      const line = pending.join('')
      pending = []
      pendingChars = 0
      onLine(line)
    }
    pending.push(last)
    pendingChars += last.length
    if (pendingChars > MAX_LINE_CHARS) {
      onOverflow()
    }
  }
}

/** Resolves with the exit code, or undefined once `signal` aborted the run. */
export function runOnLauncher(
  endpoint: LauncherEndpoint,
  request: LauncherRunRequest,
  handlers: LauncherRunHandlers
): Promise<number | undefined> {
  const { signal } = handlers
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve(undefined)
      return
    }
    let settled = false
    let runId: string | undefined
    const socket: Socket = connect({ host: endpoint.host, port: endpoint.port })
    const finish = (outcome: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(startTimer)
      signal.removeEventListener('abort', onAbort)
      outcome()
    }
    const fail = (error: DesktopError): void => {
      finish(() => reject(error))
      socket.destroy()
    }
    const startTimer = setTimeout(
      () => fail(new DesktopError('desktop_run_unavailable', 'launcher_timeout')),
      START_TIMEOUT_MS
    )
    const onAbort = (): void => {
      finish(() => resolve(undefined))
      if (runId === undefined || !socket.writable) {
        socket.destroy()
        return
      }
      const kill = JSON.stringify({ token: endpoint.token, op: 'kill', id: runId })
      const flushTimer = setTimeout(() => socket.destroy(), KILL_FLUSH_MS)
      socket.end(`${kill}\n`, () => {
        clearTimeout(flushTimer)
        socket.destroy()
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const protocolError = (): void =>
      fail(new DesktopError('desktop_run_failed', 'launcher_protocol_error'))
    const onReply = (reply: LauncherReply): void => {
      if (runId === undefined) {
        if (reply.error === 'bad_token') {
          fail(new DesktopError('desktop_launcher_rejected'))
        } else if (typeof reply.error === 'string') {
          fail(new DesktopError('desktop_run_failed', 'launcher_refused'))
        } else if (typeof reply.id === 'string' && reply.id.length > 0) {
          runId = reply.id
          clearTimeout(startTimer)
          handlers.onStarted()
        } else {
          protocolError()
        }
        return
      }
      if (
        (reply.stream === 'stdout' || reply.stream === 'stderr') &&
        typeof reply.data === 'string'
      ) {
        handlers.onOutput(reply.stream, reply.data)
      } else if (typeof reply.exit === 'number' && Number.isInteger(reply.exit)) {
        const code = reply.exit
        finish(() => resolve(code))
        socket.destroy()
      } else {
        protocolError()
      }
    }
    const read = lineReader((line) => {
      if (settled || line.trim() === '') {
        return
      }
      let reply: LauncherReply
      try {
        reply = JSON.parse(line)
      } catch {
        protocolError()
        return
      }
      if (reply === null || typeof reply !== 'object') {
        protocolError()
        return
      }
      onReply(reply)
    }, protocolError)

    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      if (!settled) {
        read(chunk)
      }
    })
    // Socket errors name the address, never the token; report only a fixed reason.
    socket.on('error', () =>
      fail(
        runId === undefined
          ? new DesktopError('desktop_run_unavailable', 'launcher_unreachable')
          : new DesktopError('desktop_run_failed', 'launcher_connection_lost')
      )
    )
    socket.once('close', () =>
      fail(new DesktopError('desktop_run_failed', 'launcher_connection_lost'))
    )
    socket.once('connect', () => {
      const run: Record<string, unknown> = { token: endpoint.token, op: 'run', argv: request.argv }
      if (request.cwd !== undefined) {
        run.cwd = request.cwd
      }
      if (request.env !== undefined) {
        run.env = request.env
      }
      socket.write(`${JSON.stringify(run)}\n`)
    })
  })
}
