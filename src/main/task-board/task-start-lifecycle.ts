import type {
  AgentSessionStatusEvent,
  AgentSessionStatusSummary
} from '../../shared/agent-session/agent-session-wire'
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
    /** Null when the handle names no PTY; throws while the graph reloads. */
    ptyIdForHandle(handle: string): string | null
    /** `gone` only once the graph is ready and nothing (leaf, PTY or saved tab) holds the pane. */
    paneBinding(paneKey: string, worktreeId: string): 'unknown' | 'gone' | { ptyId: string | null }
    /** The owning host's verdict; null makes no claim. */
    ptyLiveness(ptyId: string): PtyLivenessVerdict | null
    /** The agent's own presence in a live PTY; null when nothing identifies it. */
    agentPresence(
      handle: string,
      exitedSince: number
    ): Promise<'live' | 'unverifiable' | 'exited' | null>
    subscribeExit(ptyId: string, listener: () => void): () => void
    /** Confirmed agent exits in this PTY (the shell may live on). */
    subscribeAgentExited(ptyId: string, listener: () => void): () => void
  }
  chat: {
    /** From the structured-session authority: an idle chat is alive, a closed one gone. */
    liveness(sessionId: string): OrchestratorLiveness
    /** The session continuing this chat, its `/clear` successor included; null when unknown. */
    liveSessionId(sessionId: string): string | null
    subscribeTabHidden(listener: (sessionId: string) => void): () => void
    /** Null when no structured-session host is installed. */
    subscribeStatus(listener: (event: AgentSessionStatusEvent) => void): (() => void) | null
  }
  /** Bounds one reconcile; past it, runs are left as they are. */
  reconcileTimeoutMs?: number
}

const ORCHESTRATOR_EXITED = { state: 'failed', failure: 'orchestrator-exited' } as const
const RECONCILE_TIMEOUT_MS = 2000

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

type TerminalTarget = { liveness: OrchestratorLiveness; ptyId?: string }

function resolveTerminalPty(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps
): TerminalTarget {
  if (ref.ptyId) {
    return { liveness: 'alive', ptyId: ref.ptyId }
  }
  const byHandle = ref.handle ? deps.terminal.ptyIdForHandle(ref.handle) : null
  if (byHandle) {
    return { liveness: 'alive', ptyId: byHandle }
  }
  // A restart re-mints handles; the pane key still names the pane.
  const binding = ref.paneKey ? deps.terminal.paneBinding(ref.paneKey, ref.worktreeId) : 'unknown'
  if (binding === 'gone') {
    return { liveness: 'gone' }
  }
  return binding !== 'unknown' && binding.ptyId
    ? { liveness: 'alive', ptyId: binding.ptyId }
    : { liveness: 'unverifiable' }
}

function ptyLiveness(ptyId: string, deps: TaskStartLifecycleDeps): OrchestratorLiveness {
  const verdict = deps.terminal.ptyLiveness(ptyId)?.status
  return verdict === 'live' ? 'alive' : verdict === 'exited' ? 'gone' : 'unverifiable'
}

async function probeTerminal(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps,
  startedAt: string | undefined
): Promise<TerminalTarget> {
  const target = resolveTerminalPty(ref, deps)
  if (!target.ptyId) {
    return target
  }
  const liveness = ptyLiveness(target.ptyId, deps)
  const since = startedAt ? Date.parse(startedAt) : Number.NaN
  if (liveness !== 'alive' || !ref.handle || !Number.isFinite(since)) {
    return { liveness, ptyId: target.ptyId }
  }
  // A live PTY can hold the shell the agent exited back to.
  const agent = await deps.terminal.agentPresence(ref.handle, since)
  return { liveness: agent === 'exited' ? 'gone' : liveness, ptyId: target.ptyId }
}

function chatLiveness(sessionId: string, deps: TaskStartLifecycleDeps): OrchestratorLiveness {
  try {
    return deps.chat.liveness(sessionId)
  } catch {
    return 'unverifiable'
  }
}

async function probeOrchestratorTarget(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps,
  startedAt?: string
): Promise<TerminalTarget> {
  if (!deps.hostReachable(ref.hostId)) {
    return { liveness: 'unverifiable' }
  }
  try {
    if (ref.surface === 'chat') {
      return { liveness: ref.sessionId ? chatLiveness(ref.sessionId, deps) : 'unverifiable' }
    }
    return await probeTerminal(ref, deps, startedAt)
  } catch {
    return { liveness: 'unverifiable' }
  }
}

/** `startedAt` (the run's) lets an agent that exited back to its shell read as gone. */
export async function probeOrchestrator(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps,
  startedAt?: string
): Promise<OrchestratorLiveness> {
  return (await probeOrchestratorTarget(ref, deps, startedAt)).liveness
}

function failExited(runId: string, deps: TaskStartLifecycleDeps): void {
  // A stopping run is the stop's to settle.
  if (deps.store.transition(runId, ['running', 'waiting'], ORCHESTRATOR_EXITED)) {
    stopTaskStartWatcher(deps.store, runId)
  }
}

function watchTerminal(
  run: TaskStartRun,
  ref: TaskStartOrchestratorRef,
  ptyId: string,
  deps: TaskStartLifecycleDeps,
  unwatched: () => void
): () => void {
  const stops = [
    deps.terminal.subscribeExit(ptyId, () => {
      unwatched()
      failExited(run.id, deps)
    }),
    deps.terminal.subscribeAgentExited(ptyId, () => {
      // A dropped SSH relay can read as an agent exit; only act on what the host can still see.
      if (deps.hostReachable(ref.hostId) && ptyLiveness(ptyId, deps) !== 'unverifiable') {
        failExited(run.id, deps)
      }
    })
  ]
  return () => stops.forEach((stop) => stop())
}

function closedSummary(event: AgentSessionStatusEvent, sessionId: string): boolean {
  const sessions: AgentSessionStatusSummary[] =
    event.type === 'status' ? [event.session] : event.type === 'snapshot' ? event.sessions : []
  // Closing revokes live authority; only then ask the authority whether the chat is gone.
  return sessions.some((session) => session.sessionId === sessionId && !session.hostExecutionOwned)
}

function watchChat(runId: string, sessionId: string, deps: TaskStartLifecycleDeps): () => void {
  let stopped = false
  const checkClosed = (): void => {
    if (!stopped && chatLiveness(sessionId, deps) === 'gone') {
      failExited(runId, deps)
    }
  }
  const stopTabHidden = deps.chat.subscribeTabHidden((hidden) => {
    if (hidden === sessionId || deps.chat.liveSessionId(sessionId) === hidden) {
      checkClosed()
    }
  })
  // Secondary: a released status row; `end` is our own subscription ending, never the session's.
  const stopStatus = deps.chat.subscribeStatus((event) => {
    if (event.type !== 'end' && closedSummary(event, sessionId)) {
      checkClosed()
    }
  })
  return () => {
    stopped = true
    stopTabHidden()
    stopStatus?.()
  }
}

function startWatch(
  run: TaskStartRun,
  deps: TaskStartLifecycleDeps,
  ptyId: string | undefined,
  unwatched: () => void
): (() => void) | null {
  const ref = run.orchestrator
  if (ref?.surface === 'chat' && ref.sessionId) {
    return watchChat(run.id, ref.sessionId, deps)
  }
  if (ref?.surface !== 'terminal') {
    return null
  }
  let pty = ptyId
  try {
    pty ??= resolveTerminalPty(ref, deps).ptyId
  } catch {
    // The graph is reloading; the next reconcile resolves it.
  }
  return pty ? watchTerminal(run, ref, pty, deps, unwatched) : null
}

/** One watcher per run in this process: fails the run when its orchestrator ends while it is
 *  running or waiting. Repeated calls keep the installed watcher. Returns its stop. */
export function watchTaskStartOrchestrator(
  run: TaskStartRun,
  deps: TaskStartLifecycleDeps,
  target: { ptyId?: string } = {}
): () => void {
  const stopRegistered = () => stopTaskStartWatcher(deps.store, run.id)
  const watchers = watchersOf(deps.store)
  if (watchers.has(run.id)) {
    return stopRegistered
  }
  let installed: (() => void) | null = null
  let ended = false
  const unwatched = (): void => {
    ended = true
    if (installed && watchers.get(run.id) === installed) {
      watchers.delete(run.id)
      installed()
    }
  }
  const stop = startWatch(run, deps, target.ptyId, unwatched)
  const current = deps.store.getById(run.id)
  if (!stop || ended || !current || !isTaskStartRunExclusive(current)) {
    stop?.()
    return () => {}
  }
  installed = stop
  watchers.set(run.id, stop)
  return stopRegistered
}

export function stopTaskStartWatcher(store: TaskStartRunStore, runId: string): void {
  const watchers = watchersOf(store)
  const stop = watchers.get(runId)
  watchers.delete(runId)
  stop?.()
}

async function reconcileRun(
  run: TaskStartRun,
  deps: TaskStartLifecycleDeps,
  expired: () => boolean
): Promise<void> {
  const ref = run.orchestrator
  if (!ref) {
    return
  }
  const { liveness, ptyId } = await probeOrchestratorTarget(ref, deps, run.startedAt)
  if (expired() || deps.store.inFlight.has(run.id)) {
    return
  }
  if (liveness === 'gone') {
    failExited(run.id, deps)
  } else if (liveness === 'alive') {
    watchTaskStartOrchestrator(run, deps, { ptyId })
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
  if (published.length === 0) {
    return
  }
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve()
    }, deps.reconcileTimeoutMs ?? RECONCILE_TIMEOUT_MS)
  })
  // Each run settles alone: one failing probe leaves the others to finish.
  const settled = Promise.allSettled(published.map((run) => reconcileRun(run, deps, () => expired)))
  try {
    await Promise.race([settled, deadline])
  } finally {
    clearTimeout(timer)
  }
}
