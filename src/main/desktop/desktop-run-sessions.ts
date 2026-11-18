import { randomBytes } from 'node:crypto'
import { DesktopError } from './desktop-errors'
import {
  runOnLauncher,
  type LauncherEndpoint,
  type LauncherRunFlow,
  type LauncherRunRequest
} from './desktop-launcher-client'

export type DesktopRunEvent = { stream: 'stdout' | 'stderr'; data: string }

export type DesktopRunReadResult = { events: DesktopRunEvent[]; cursor: number; exit?: number }

/** Budget of unread output; each event costs its payload bytes plus a fixed overhead. */
const MAX_UNREAD_OUTPUT_COST = 1024 * 1024
const OUTPUT_EVENT_OVERHEAD = 256
/** One read returns at most this much payload (at least one event), well under reply limits. */
const MAX_READ_PAYLOAD_BYTES = 512 * 1024
const LEASE_MS = 60_000
const RETAIN_AFTER_EXIT_MS = 60_000
const MAX_RUNS = 32

const eventCost = (event: DesktopRunEvent): number =>
  Buffer.byteLength(event.data, 'utf8') + OUTPUT_EVENT_OVERHEAD

type Outcome = { exit: number } | { error: unknown }

class DesktopRunSession {
  /** Events not yet released by a read's cursor; `released` events came before them. */
  readonly events: DesktopRunEvent[] = []
  released = 0
  cost = 0
  outcome: Outcome | undefined
  flow: LauncherRunFlow | undefined
  paused = false
  exitReturned = false
  timer: ReturnType<typeof setTimeout> | undefined
  readonly cancel = new AbortController()
  readonly waiters = new Set<() => void>()

  constructor(readonly owner: string) {}

  get produced(): number {
    return this.released + this.events.length
  }

  wake(): void {
    for (const waiter of this.waiters) {
      waiter()
    }
    this.waiters.clear()
  }

  push(event: DesktopRunEvent): void {
    this.events.push(event)
    this.cost += eventCost(event)
    if (!this.paused && this.cost > MAX_UNREAD_OUTPUT_COST) {
      this.paused = true
      this.flow?.pause()
    }
    this.wake()
  }

  release(cursor: number): void {
    const count = cursor - this.released
    for (const event of this.events.splice(0, count)) {
      this.cost -= eventCost(event)
    }
    this.released = cursor
    if (this.paused && this.cost <= MAX_UNREAD_OUTPUT_COST) {
      this.paused = false
      this.flow?.resume()
    }
  }

  /** Unread events from the cursor on, bounded so one reply stays small. */
  take(): DesktopRunEvent[] {
    const taken: DesktopRunEvent[] = []
    let bytes = 0
    for (const event of this.events) {
      const size = Buffer.byteLength(event.data, 'utf8')
      if (taken.length > 0 && bytes + size > MAX_READ_PAYLOAD_BYTES) {
        break
      }
      taken.push(event)
      bytes += size
    }
    return taken
  }
}

/**
 * Programs started on the desktop, read by unary long polls so any transport (the local CLI
 * socket included) can drive them. A run is bound to the caller that started it; others see
 * `desktop_run_not_found`. Output waits in a 1 MiB buffer: past it the launcher is no longer
 * read, so a slow reader holds back the program instead of growing memory. A run nobody reads
 * for 60 s is killed, and a finished run is forgotten 60 s after its exit was returned.
 */
export class DesktopRunSessions {
  readonly #runs = new Map<string, DesktopRunSession>()

  async start(
    endpoint: LauncherEndpoint,
    request: LauncherRunRequest,
    owner: string
  ): Promise<string> {
    if (this.#runs.size >= MAX_RUNS) {
      throw new DesktopError('desktop_run_unavailable', 'too_many_runs')
    }
    const runId = randomBytes(16).toString('base64url')
    const session = new DesktopRunSession(owner)
    let onStarted = (): void => {}
    const started = new Promise<void>((resolve) => {
      onStarted = resolve
    })
    const finished = runOnLauncher(endpoint, request, {
      signal: session.cancel.signal,
      onStarted: (flow) => {
        session.flow = flow
        this.#runs.set(runId, session)
        this.#lease(runId, session)
        onStarted()
      },
      onOutput: (stream, data) => session.push({ stream, data })
    })
    finished.then(
      (exit) => {
        if (exit !== undefined) {
          this.#finish(session, { exit })
        }
      },
      (error: unknown) => this.#finish(session, { error })
    )
    // A refusal before the launcher named the run fails the start itself.
    await Promise.race([started, finished])
    return runId
  }

  async read(
    runId: string,
    owner: string,
    cursor: number,
    waitMs: number,
    signal?: AbortSignal
  ): Promise<DesktopRunReadResult> {
    const session = this.#owned(runId, owner)
    if (cursor < session.released || cursor > session.produced) {
      throw new DesktopError('desktop_invalid_input', 'cursor_out_of_range')
    }
    session.release(cursor)
    this.#touch(runId, session)
    if (session.events.length === 0 && session.outcome === undefined && waitMs > 0) {
      await this.#waitForChange(session, waitMs, signal)
      // A kill or the lease may have ended the run while this read waited.
      this.#owned(runId, owner)
      this.#touch(runId, session)
    }
    const events = session.take()
    const next = cursor + events.length
    const result: DesktopRunReadResult = { events, cursor: next }
    if (next === session.produced && session.outcome !== undefined) {
      if ('error' in session.outcome) {
        this.#returnedOutcome(runId, session)
        throw session.outcome.error
      }
      result.exit = session.outcome.exit
      this.#returnedOutcome(runId, session)
    }
    return result
  }

  /** Kills the run on the launcher (if still running) and forgets it. */
  kill(runId: string, owner: string): { killed: boolean } {
    const session = this.#owned(runId, owner)
    const running = session.outcome === undefined
    this.#forget(runId, session)
    return { killed: running }
  }

  /** Unread events held for a run; for tests and diagnostics. */
  bufferedEvents(runId: string): number | undefined {
    return this.#runs.get(runId)?.events.length
  }

  close(): void {
    for (const [runId, session] of this.#runs) {
      this.#forget(runId, session)
    }
  }

  #owned(runId: string, owner: string): DesktopRunSession {
    const session = this.#runs.get(runId)
    if (!session || session.owner !== owner) {
      throw new DesktopError('desktop_run_not_found')
    }
    return session
  }

  #finish(session: DesktopRunSession, outcome: Outcome): void {
    if (session.outcome === undefined) {
      session.outcome = outcome
      session.wake()
    }
  }

  #lease(runId: string, session: DesktopRunSession): void {
    clearTimeout(session.timer)
    session.timer = setTimeout(() => this.#forget(runId, session), LEASE_MS)
  }

  /** A read renews the lease, until the exit was returned: then the retention clock runs. */
  #touch(runId: string, session: DesktopRunSession): void {
    if (!session.exitReturned) {
      this.#lease(runId, session)
    }
  }

  #returnedOutcome(runId: string, session: DesktopRunSession): void {
    if (session.exitReturned) {
      return
    }
    session.exitReturned = true
    clearTimeout(session.timer)
    session.timer = setTimeout(() => this.#forget(runId, session), RETAIN_AFTER_EXIT_MS)
  }

  #forget(runId: string, session: DesktopRunSession): void {
    clearTimeout(session.timer)
    if (this.#runs.get(runId) === session) {
      this.#runs.delete(runId)
    }
    // Aborting a run that is still going sends the launcher `kill` and closes the socket.
    session.cancel.abort()
    session.wake()
  }

  #waitForChange(session: DesktopRunSession, waitMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        session.waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      signal?.addEventListener('abort', done, { once: true })
      session.waiters.add(done)
      if (signal?.aborted) {
        done()
      }
    })
  }
}
