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
const MAX_ACTIVE_RUNS = 32

const eventCost = (event: DesktopRunEvent): number =>
  Buffer.byteLength(event.data, 'utf8') + OUTPUT_EVENT_OVERHEAD

/** The longest prefix of `data` that is at most `maxBytes` in UTF-8, never splitting a character. */
function utf8Prefix(data: string, maxBytes: number): string {
  if (Buffer.byteLength(data, 'utf8') <= maxBytes) {
    return data
  }
  let bytes = 0
  let end = 0
  for (const char of data) {
    const code = char.codePointAt(0) ?? 0
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes + size > maxBytes) {
      break
    }
    bytes += size
    end += char.length
  }
  return data.slice(0, end)
}

type Outcome = { exit: number } | { error: unknown }

class DesktopRunSession {
  /** Events not yet released by a read's cursor; `released` events came before them. */
  readonly events: DesktopRunEvent[] = []
  /** Output the launcher sent that does not fit the budget yet; the launcher is paused meanwhile. */
  readonly held: DesktopRunEvent[] = []
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

  /** Every unread event was admitted and the run has ended. */
  get drained(): boolean {
    return this.outcome !== undefined && this.held.length === 0
  }

  push(event: DesktopRunEvent): void {
    this.held.push(event)
    this.#admit()
    this.wake()
  }

  release(cursor: number): void {
    const count = cursor - this.released
    for (const event of this.events.splice(0, count)) {
      this.cost -= eventCost(event)
    }
    this.released = cursor
    this.#admit()
  }

  /** Moves held output into the buffer while it fits, splitting a frame at the remaining credit. */
  #admit(): void {
    while (this.held.length > 0) {
      const event = this.held[0]!
      const credit = MAX_UNREAD_OUTPUT_COST - this.cost - OUTPUT_EVENT_OVERHEAD
      const data = credit < 0 ? '' : utf8Prefix(event.data, credit)
      if (credit < 0 || (data.length === 0 && event.data.length > 0)) {
        break
      }
      const admitted = { stream: event.stream, data }
      this.events.push(admitted)
      this.cost += eventCost(admitted)
      if (data.length === event.data.length) {
        this.held.shift()
      } else {
        event.data = event.data.slice(data.length)
      }
    }
    const full = this.held.length > 0
    if (full !== this.paused) {
      this.paused = full
      if (full) {
        this.flow?.pause()
      } else {
        this.flow?.resume()
      }
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
  readonly #maxActiveRuns: number
  /** Runs starting or running; finished runs kept for their exit do not count. */
  #active = 0

  constructor({ maxActiveRuns = MAX_ACTIVE_RUNS }: { maxActiveRuns?: number } = {}) {
    this.#maxActiveRuns = maxActiveRuns
  }

  async start(
    endpoint: LauncherEndpoint,
    request: LauncherRunRequest,
    owner: string
  ): Promise<string> {
    // Taken before the launcher answers, so concurrent starts cannot pass the cap together.
    if (this.#active >= this.#maxActiveRuns) {
      throw new DesktopError('desktop_run_unavailable', 'too_many_runs')
    }
    this.#active++
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
    // The launcher run settles on exit, failure or kill: each frees the slot once.
    finished.then(
      (exit) => {
        this.#active--
        if (exit !== undefined) {
          this.#finish(session, { exit })
        }
      },
      (error: unknown) => {
        this.#active--
        this.#finish(session, { error })
      }
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
    if (session.events.length === 0 && !session.drained && waitMs > 0) {
      await this.#waitForChange(session, waitMs, signal)
      // A kill or the lease may have ended the run while this read waited.
      this.#owned(runId, owner)
      this.#touch(runId, session)
    }
    const events = session.take()
    const next = cursor + events.length
    const result: DesktopRunReadResult = { events, cursor: next }
    if (next === session.produced && session.drained && session.outcome !== undefined) {
      if ('error' in session.outcome) {
        // Output from before the failure goes out first; the next read reports the failure.
        if (events.length > 0) {
          return result
        }
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

  /** What a run's unread buffer costs against its budget; for tests and diagnostics. */
  bufferedCost(runId: string): number | undefined {
    return this.#runs.get(runId)?.cost
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
