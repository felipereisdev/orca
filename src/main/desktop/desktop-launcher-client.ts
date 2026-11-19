import { connect, isIP, type Socket } from 'node:net'
import { DesktopError } from './desktop-errors'
import {
  isLauncherNonce,
  launcherClientProof,
  launcherServerProof,
  newLauncherNonce,
  proofMatches
} from './desktop-launcher-handshake'
import { launcherLineReader } from './desktop-launcher-line-reader'

/**
 * JSON-lines protocol with the in-environment launcher (starts programs as user `gui`), one TCP
 * connection per program. The token never crosses the connection: both sides prove it first
 * (desktop-launcher-handshake.ts), the launcher before the client sends anything else.
 *   → {"op":"hello","nonce":"<broker nonce>"}
 *   ← {"nonce":"<launcher nonce>","proof":"<server proof>"}   a bad proof: desktop_launcher_rejected
 *   → {"op":"run","proof":"<client proof>","argv":[…],"cwd"?,"env"?}
 *   ← {"id":"<run id>"}                          started, in its own process group
 *   ← {"stream":"stdout"|"stderr","data":"…"}   any number of these
 *   ← {"exit":<code>}                            then the launcher closes (signal death: 128 + n)
 *   → {"op":"kill","id":"<run id>"}             kills the process group; the client then closes
 * Instead of the id, a refusal closes the connection: {"error":"bad_token"} for a wrong proof,
 * {"error":"<code>"} otherwise. The launcher also kills a run whose connection closes.
 * Flow control is TCP's: the client stops reading while its consumer is behind, and the launcher
 * must then stop reading the program's pipes instead of buffering without bound.
 * The token reaches the launcher only on its stdin and stays in its memory; here it only keys the
 * proofs: never into lines, errors, logs or events.
 */
export type LauncherEndpoint = { host: string; port: number; token: string }

export type LauncherRunRequest = { argv: string[]; cwd?: string; env?: Record<string, string> }

/** Pauses and resumes reading the launcher's output. */
export type LauncherRunFlow = { pause(): void; resume(): void }

export type LauncherRunHandlers = {
  signal: AbortSignal
  onStarted(flow: LauncherRunFlow): void
  onOutput(stream: 'stdout' | 'stderr', data: string): void
}

const START_TIMEOUT_MS = 10_000
const KILL_FLUSH_MS = 2_000

type LauncherReply = {
  nonce?: unknown
  proof?: unknown
  id?: unknown
  error?: unknown
  stream?: unknown
  data?: unknown
  exit?: unknown
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
    // The broker hands over a literal loopback address; a name would go through DNS with the token.
    if (isIP(endpoint.host) === 0) {
      reject(new DesktopError('desktop_run_unavailable', 'launcher_host_not_literal'))
      return
    }
    let settled = false
    const brokerNonce = newLauncherNonce()
    let authenticated = false
    let connected = false
    let runId: string | undefined
    let paused = false
    let socketClosed = false
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
      const kill = JSON.stringify({ op: 'kill', id: runId })
      const flushTimer = setTimeout(() => socket.destroy(), KILL_FLUSH_MS)
      socket.end(`${kill}\n`, () => {
        clearTimeout(flushTimer)
        socket.destroy()
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })

    // Before the launcher proved the token, anything unexpected is a rejection: the peer is unproven.
    const protocolError = (): void =>
      fail(
        authenticated
          ? new DesktopError('desktop_run_failed', 'launcher_protocol_error')
          : new DesktopError('desktop_launcher_rejected')
      )
    const sendRun = (launcherNonce: string): void => {
      const run: Record<string, unknown> = {
        op: 'run',
        proof: launcherClientProof(endpoint.token, launcherNonce, brokerNonce),
        argv: request.argv
      }
      if (request.cwd !== undefined) {
        run.cwd = request.cwd
      }
      if (request.env !== undefined) {
        run.env = request.env
      }
      socket.write(`${JSON.stringify(run)}\n`)
    }
    const onReply = (reply: LauncherReply): void => {
      if (!authenticated) {
        // Whatever answers on the port gets nothing secret until it proves the token.
        if (
          isLauncherNonce(reply.nonce) &&
          proofMatches(launcherServerProof(endpoint.token, brokerNonce, reply.nonce), reply.proof)
        ) {
          authenticated = true
          sendRun(reply.nonce)
        } else {
          fail(new DesktopError('desktop_launcher_rejected'))
        }
        return
      }
      if (runId === undefined) {
        if (reply.error === 'bad_token') {
          fail(new DesktopError('desktop_launcher_rejected'))
        } else if (typeof reply.error === 'string') {
          fail(new DesktopError('desktop_run_failed', 'launcher_refused'))
        } else if (typeof reply.id === 'string' && reply.id.length > 0) {
          runId = reply.id
          clearTimeout(startTimer)
          handlers.onStarted({
            pause: () => {
              paused = true
              socket.pause()
            },
            resume: () => {
              paused = false
              socket.resume()
              drain()
            }
          })
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
    const read = launcherLineReader(
      (line) => {
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
        // Nothing a peer sends may throw out of this socket callback.
        try {
          onReply(reply)
        } catch {
          protocolError()
        }
      },
      protocolError,
      () => paused
    )
    // Chunks the socket still delivers after a pause wait here, so output stops at the line.
    const queue: string[] = []
    const drain = (): void => {
      while (!paused && !settled && queue.length > 0) {
        const rest = read(queue.shift() ?? '')
        if (rest) {
          queue.unshift(rest)
        }
      }
      // A close counts only once everything read before it, maybe its exit, was handled. A peer
      // that closes before proving the token (even mid-frame) is rejected, not a lost run.
      if (socketClosed && queue.length === 0) {
        fail(
          authenticated
            ? new DesktopError('desktop_run_failed', 'launcher_connection_lost')
            : new DesktopError('desktop_launcher_rejected')
        )
      }
    }

    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      if (!settled) {
        queue.push(chunk)
        drain()
      }
    })
    // Socket errors name the address, never the token; report only a fixed reason.
    socket.on('error', () =>
      fail(
        !connected
          ? new DesktopError('desktop_run_unavailable', 'launcher_unreachable')
          : !authenticated
            ? new DesktopError('desktop_launcher_rejected')
            : runId === undefined
              ? new DesktopError('desktop_run_unavailable', 'launcher_unreachable')
              : new DesktopError('desktop_run_failed', 'launcher_connection_lost')
      )
    )
    socket.once('close', () => {
      socketClosed = true
      if (paused && queue.length > 0) {
        return
      }
      queue.length = 0
      drain()
    })
    socket.once('connect', () => {
      connected = true
      socket.write(`${JSON.stringify({ op: 'hello', nonce: brokerNonce })}\n`)
    })
  })
}
