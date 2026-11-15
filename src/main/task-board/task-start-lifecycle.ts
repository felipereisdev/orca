import type {
  AgentSessionStatusEvent,
  AgentSessionStatusSummary
} from '../../shared/agent-session/agent-session-wire'
import type { RuntimeTerminalShow } from '../../shared/runtime-terminal-contracts'
import {
  isTaskStartRunExclusive,
  type TaskStartOrchestratorRef,
  type TaskStartRun
} from '../../shared/task-board/task-start-run'
import type { PtyLivenessVerdict } from '../../shared/terminal/pty/lifecycle/pty-liveness-verdict'
import type { TaskStartRunStore } from './task-start-run-store'

export type OrchestratorLiveness = 'alive' | 'gone' | 'unverifiable'

export type TaskStartLifecycleDeps = {
  store: TaskStartRunStore
  /** False for an SSH host that is not connected, or a host this process cannot observe. */
  hostReachable(hostId: string): boolean
  terminal: {
    /** Rejects `terminal_handle_stale` when the handle names no terminal. */
    show(handle: string): Promise<Pick<RuntimeTerminalShow, 'connected' | 'exitCause' | 'verdict'>>
    handleForPaneKey(paneKey: string): string | null
    liveness(handle: string): PtyLivenessVerdict | null
    /** Settles when the terminal's process has ended. */
    waitForExit(handle: string, signal: AbortSignal): Promise<unknown>
  }
  chat: {
    /** From the structured-session authority: an idle chat is alive, a closed one gone. */
    liveness(sessionId: string): OrchestratorLiveness
    /** Null when no structured-session host is installed. */
    subscribeStatus(listener: (event: AgentSessionStatusEvent) => void): (() => void) | null
  }
}

const HANDLE_STALE = 'terminal_handle_stale'
const ORCHESTRATOR_EXITED = { state: 'failed', failure: 'orchestrator-exited' } as const

// Watchers live in this process only; keyed by store so each host runtime keeps its own.
const watchersByStore = new WeakMap<TaskStartRunStore, Map<string, () => void>>()

function watchersOf(store: TaskStartRunStore): Map<string, () => void> {
  let watchers = watchersByStore.get(store)
  if (!watchers) {
    watchers = new Map()
    watchersByStore.set(store, watchers)
  }
  return watchers
}

type ShownTerminal = Awaited<ReturnType<TaskStartLifecycleDeps['terminal']['show']>>

/** null: the handle names no terminal. Any other failure (a reloading graph) proves nothing. */
async function showTerminal(
  handle: string,
  deps: TaskStartLifecycleDeps
): Promise<ShownTerminal | null> {
  try {
    return await deps.terminal.show(handle)
  } catch (error) {
    if (error instanceof Error && error.message === HANDLE_STALE) {
      return null
    }
    throw error
  }
}

function terminalLiveness(
  handle: string,
  shown: ShownTerminal,
  deps: TaskStartLifecycleDeps
): OrchestratorLiveness {
  const verdict = deps.terminal.liveness(handle)?.status ?? shown.verdict
  if (verdict) {
    return verdict === 'live' ? 'alive' : verdict === 'exited' ? 'gone' : 'unverifiable'
  }
  if (shown.connected) {
    return 'alive'
  }
  // Disconnected without a recorded exit may be a dropped relay, not a death.
  return shown.exitCause ? 'gone' : 'unverifiable'
}

async function probeTerminal(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps
): Promise<{ liveness: OrchestratorLiveness; handle?: string }> {
  // A restart re-mints handles; the pane key still names the same pane.
  const resolvers: (() => string | null | undefined)[] = [
    () => ref.handle,
    () => (ref.paneKey ? deps.terminal.handleForPaneKey(ref.paneKey) : null)
  ]
  const tried = new Set<string>()
  for (const resolve of resolvers) {
    const handle = resolve()
    if (!handle || tried.has(handle)) {
      continue
    }
    tried.add(handle)
    const shown = await showTerminal(handle, deps)
    if (shown) {
      return { liveness: terminalLiveness(handle, shown, deps), handle }
    }
  }
  return { liveness: 'gone' }
}

async function probeOrchestratorTarget(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps
): Promise<{ liveness: OrchestratorLiveness; handle?: string }> {
  if (!deps.hostReachable(ref.hostId)) {
    return { liveness: 'unverifiable' }
  }
  try {
    if (ref.surface === 'chat') {
      return { liveness: ref.sessionId ? chatLiveness(ref.sessionId, deps) : 'unverifiable' }
    }
    return await probeTerminal(ref, deps)
  } catch {
    return { liveness: 'unverifiable' }
  }
}

export async function probeOrchestrator(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps
): Promise<OrchestratorLiveness> {
  return (await probeOrchestratorTarget(ref, deps)).liveness
}

function failExited(runId: string, deps: TaskStartLifecycleDeps): void {
  // A stopping run is the stop's to settle.
  if (deps.store.transition(runId, ['running', 'waiting'], ORCHESTRATOR_EXITED)) {
    stopTaskStartWatcher(deps.store, runId)
  }
}

function watchTerminal(
  runId: string,
  handle: string,
  deps: TaskStartLifecycleDeps,
  unwatched: () => void
): () => void {
  const abort = new AbortController()
  deps.terminal.waitForExit(handle, abort.signal).then(
    () => {
      if (!abort.signal.aborted) {
        unwatched()
        failExited(runId, deps)
      }
    },
    () => {
      // Aborted, or the wait lost its terminal: the next reconcile probes again.
      unwatched()
    }
  )
  return () => abort.abort()
}

function closedSummary(event: AgentSessionStatusEvent, sessionId: string): boolean {
  const sessions: AgentSessionStatusSummary[] =
    event.type === 'status' ? [event.session] : event.type === 'snapshot' ? event.sessions : []
  // Closing revokes live authority; only then ask the authority whether the chat is gone.
  return sessions.some((session) => session.sessionId === sessionId && !session.hostExecutionOwned)
}

function chatLiveness(sessionId: string, deps: TaskStartLifecycleDeps): OrchestratorLiveness {
  try {
    return deps.chat.liveness(sessionId)
  } catch {
    return 'unverifiable'
  }
}

function watchChat(
  runId: string,
  sessionId: string,
  deps: TaskStartLifecycleDeps,
  unwatched: () => void
): (() => void) | null {
  let stopped = false
  const unsubscribe = deps.chat.subscribeStatus((event) => {
    if (stopped) {
      return
    }
    if (event.type === 'end') {
      // Our subscription ended, not the session: let the next reconcile resubscribe.
      unwatched()
      return
    }
    if (closedSummary(event, sessionId) && chatLiveness(sessionId, deps) === 'gone') {
      failExited(runId, deps)
    }
  })
  if (!unsubscribe) {
    return null
  }
  return () => {
    stopped = true
    unsubscribe()
  }
}

function startWatch(
  run: TaskStartRun,
  deps: TaskStartLifecycleDeps,
  handle: string | undefined,
  unwatched: () => void
): (() => void) | null {
  const ref = run.orchestrator
  if (ref?.surface === 'terminal' && handle) {
    return watchTerminal(run.id, handle, deps, unwatched)
  }
  if (ref?.surface === 'chat' && ref.sessionId) {
    return watchChat(run.id, ref.sessionId, deps, unwatched)
  }
  return null
}

/** Fails the run when its orchestrator ends while it is running or waiting. */
export function watchTaskStartOrchestrator(
  run: TaskStartRun,
  deps: TaskStartLifecycleDeps,
  handle: string | undefined = run.orchestrator?.handle
): () => void {
  return startWatch(run, deps, handle, () => {}) ?? (() => {})
}

/** Installs one watcher per run in this process; a no-op when one is already installed. */
export function ensureTaskStartWatcher(
  run: TaskStartRun,
  deps: TaskStartLifecycleDeps,
  handle: string | undefined = run.orchestrator?.handle
): void {
  const watchers = watchersOf(deps.store)
  if (watchers.has(run.id)) {
    return
  }
  let installed: (() => void) | null = null
  let ended = false
  const unwatched = (): void => {
    ended = true
    if (installed && watchers.get(run.id) === installed) {
      watchers.delete(run.id)
    }
  }
  const stop = startWatch(run, deps, handle, unwatched)
  const current = deps.store.getById(run.id)
  if (!stop || ended || !current || !isTaskStartRunExclusive(current)) {
    stop?.()
    return
  }
  installed = stop
  watchers.set(run.id, stop)
}

export function stopTaskStartWatcher(store: TaskStartRunStore, runId: string): void {
  const watchers = watchersOf(store)
  const stop = watchers.get(runId)
  watchers.delete(runId)
  stop?.()
}

async function reconcileRun(run: TaskStartRun, deps: TaskStartLifecycleDeps): Promise<void> {
  const ref = run.orchestrator
  if (!ref) {
    return
  }
  const { liveness, handle } = await probeOrchestratorTarget(ref, deps)
  if (deps.store.inFlight.has(run.id)) {
    return
  }
  if (liveness === 'gone') {
    failExited(run.id, deps)
  } else if (liveness === 'alive') {
    ensureTaskStartWatcher(run, deps, handle ?? ref.handle)
  }
}

/** Brings exclusive runs in line with their orchestrators; starts alive in this process are skipped. */
export async function reconcileTaskStartRuns(deps: TaskStartLifecycleDeps): Promise<void> {
  const runs = deps.store.listExclusive()
  const exclusive = new Set(runs.map((run) => run.id))
  for (const runId of watchersOf(deps.store).keys()) {
    if (!exclusive.has(runId)) {
      stopTaskStartWatcher(deps.store, runId)
    }
  }
  const published: TaskStartRun[] = []
  // Synchronous with the inFlight check, so a start cannot slip in between.
  for (const run of runs) {
    if (deps.store.inFlight.has(run.id)) {
      continue
    }
    if (run.launch === 'pending') {
      deps.store.transition(run.id, ['running', 'waiting', 'stopping'], {
        state: 'failed',
        failure: 'launch-failed'
      })
    } else {
      published.push(run)
    }
  }
  await Promise.all(published.map((run) => reconcileRun(run, deps)))
}
