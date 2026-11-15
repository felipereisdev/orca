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
import type { OrchestratorLiveness, TaskStartLifecycleDeps } from './task-start-lifecycle-contract'

export type { OrchestratorLiveness, TaskStartLifecycleDeps } from './task-start-lifecycle-contract'

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

type PtyVerdict = PtyLivenessVerdict['status'] | undefined

function ptyVerdict(ptyId: string | undefined, deps: TaskStartLifecycleDeps): PtyVerdict {
  return ptyId ? deps.terminal.ptyLiveness(ptyId)?.status : undefined
}

/** The orchestrator's PTY and its verdict; `gone` when the pane no longer holds any terminal. */
function resolveTerminalPty(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps
): 'gone' | { ptyId?: string; verdict: PtyVerdict } {
  const ptyId =
    ref.ptyId ?? (ref.handle ? deps.terminal.ptyIdForHandle(ref.handle) : null) ?? undefined
  const verdict = ptyVerdict(ptyId, deps)
  if (verdict) {
    return { ptyId, verdict }
  }
  // Verdicts live in memory: after a restart, or before a sweep, the pane says what still holds it.
  const binding = ref.paneKey ? deps.terminal.paneBinding(ref.paneKey, ref.worktreeId) : 'unknown'
  if (binding === 'gone') {
    return 'gone'
  }
  const bound = binding === 'unknown' ? null : binding.ptyId
  return bound && bound !== ptyId
    ? { ptyId: bound, verdict: ptyVerdict(bound, deps) }
    : { ptyId, verdict }
}

async function probeTerminal(
  ref: TaskStartOrchestratorRef,
  deps: TaskStartLifecycleDeps,
  startedAt: string | undefined
): Promise<TerminalTarget> {
  const target = resolveTerminalPty(ref, deps)
  if (target === 'gone' || target.verdict === 'exited') {
    return { liveness: 'gone' }
  }
  const { ptyId, verdict } = target
  if (!ptyId || verdict === 'unverifiable') {
    return { liveness: 'unverifiable', ...(ptyId ? { ptyId } : {}) }
  }
  // A live (or not yet swept) PTY can hold the shell the agent exited back to.
  const since = startedAt ? Date.parse(startedAt) : Number.NaN
  const agent =
    ref.handle && Number.isFinite(since)
      ? await deps.terminal.agentPresence(ref.handle, since)
      : null
  if (agent === 'exited') {
    return { liveness: 'gone' }
  }
  return { liveness: verdict === 'live' ? 'alive' : 'unverifiable', ptyId }
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
  let ended = false
  const onExit = (): void => {
    if (ended) {
      return
    }
    ended = true
    unwatched()
    // Exit listeners also fire for a dropped SSH relay; only a certified exit ends the run.
    if (ptyVerdict(ptyId, deps) === 'exited') {
      failExited(run.id, deps)
    }
  }
  const stops = [
    deps.terminal.subscribeExit(ptyId, onExit),
    deps.terminal.subscribeAgentExited(ptyId, () => {
      // A dropped SSH relay can read as an agent exit; no verdict yet is still the host's word.
      if (deps.hostReachable(ref.hostId) && ptyVerdict(ptyId, deps) !== 'unverifiable') {
        failExited(run.id, deps)
      }
    })
  ]
  // An exit between the probe and these subscriptions has already been certified.
  if (ptyVerdict(ptyId, deps) === 'exited') {
    onExit()
  }
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
  let pty = ptyId ?? ref.ptyId
  try {
    const resolved = pty ? null : resolveTerminalPty(ref, deps)
    pty ??= resolved && resolved !== 'gone' ? resolved.ptyId : undefined
  } catch {
    // The graph is reloading; the next reconcile resolves it.
  }
  return pty ? watchTerminal(run, ref, pty, deps, unwatched) : null
}

/** One watcher per run in this process: fails the run when its orchestrator ends while it is
 *  running or waiting. Repeated calls keep the installed watcher.
 *  The returned stop tears down that shared registered watcher, whoever installed it. */
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
  } else if (liveness === 'alive' || ptyId) {
    // A terminal without a verdict yet is still watched: only certified exits fail it.
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
