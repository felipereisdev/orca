import {
  isTaskStartRunExclusive,
  trimTaskStartRunsToLimit,
  type TaskStartRun,
  type TaskStartRunState
} from '../../shared/task-board/task-start-run'
import type { TaskStartWorkspaceMode } from '../../shared/task-board/task-start-settings'
import type { RuntimeClientEvent } from '../../shared/runtime-client-events'
import { mintAgentSessionOperationId } from '../runtime/orchestration/mailbox/structured-pointer/structured-pointer-operation-id'

const ENDED: ReadonlySet<TaskStartRunState> = new Set(['stopped', 'completed', 'failed'])

export type TaskStartRunsChangedEvent = Extract<
  RuntimeClientEvent,
  { type: 'taskBoardRunsChanged' }
>

export type TaskStartRunStoreDeps = {
  read(): Record<string, TaskStartRun>
  write(next: Record<string, TaskStartRun>): void
  now(): Date
  emit(event: TaskStartRunsChangedEvent): void
}

export type TaskStartClaimInput = {
  cardKey: string
  repoId: string
  workspaceMode: TaskStartWorkspaceMode
  primaryKey?: string
}

export type TaskStartClaimResult =
  | { ok: true; run: TaskStartRun }
  | { ok: false; reason: 'already_running' | 'primary_busy' }

/** `title` only feeds the `waiting` event; it is not persisted on the run. */
export type TaskStartRunPatch = Partial<
  Omit<TaskStartRun, 'id' | 'cardKey' | 'repoId' | 'primaryKey' | 'startedAt' | 'workspaceMode'>
> & { title?: string }

export type TaskStartOrchestratorMatch = { sessionId?: string; handle?: string; paneKey?: string }

export type TaskStartRunStore = {
  claim(input: TaskStartClaimInput): TaskStartClaimResult
  transition(
    runId: string,
    expect: TaskStartRunState[],
    patch: TaskStartRunPatch
  ): TaskStartRun | null
  get(cardKey: string): TaskStartRun | null
  getById(runId: string): TaskStartRun | null
  findByOrchestrator(match: TaskStartOrchestratorMatch): TaskStartRun | null
  listExclusive(): TaskStartRun[]
  /** runIds with a start alive in this process. */
  inFlight: Set<string>
}

export function createTaskStartRunStore(deps: TaskStartRunStoreDeps): TaskStartRunStore {
  const exclusive = () => Object.values(deps.read()).filter(isTaskStartRunExclusive)

  return {
    claim(input) {
      const live = exclusive()
      if (live.some((run) => run.cardKey === input.cardKey)) {
        return { ok: false, reason: 'already_running' }
      }
      if (input.primaryKey && live.some((run) => run.primaryKey === input.primaryKey)) {
        return { ok: false, reason: 'primary_busy' }
      }
      const now = deps.now()
      const at = now.toISOString()
      const run: TaskStartRun = {
        // Operation-shaped, so the orchestrator launch replays under the run's own id.
        id: mintAgentSessionOperationId(now.getTime()),
        cardKey: input.cardKey,
        repoId: input.repoId,
        workspaceMode: input.workspaceMode,
        ...(input.primaryKey ? { primaryKey: input.primaryKey } : {}),
        launch: 'pending',
        state: 'running',
        phase: 'starting',
        startedAt: at,
        updatedAt: at
      }
      deps.write(trimTaskStartRunsToLimit({ ...deps.read(), [run.id]: run }))
      deps.emit({ type: 'taskBoardRunsChanged', cardKeys: [run.cardKey] })
      return { ok: true, run }
    },

    transition(runId, expect, patch) {
      const runs = deps.read()
      const current = runs[runId]
      if (!current || !expect.includes(current.state)) {
        return null
      }
      const { title, ...fields } = patch
      const next: TaskStartRun = {
        ...current,
        ...fields,
        id: current.id,
        cardKey: current.cardKey,
        updatedAt: deps.now().toISOString()
      }
      // An ended run keeps no stale note (`prompt-unconfirmed`, a question) unless this end sets one.
      if (fields.state && ENDED.has(fields.state) && !('note' in fields)) {
        delete next.note
      }
      deps.write({ ...runs, [runId]: next })
      const worktreeId = next.worktreeId
      const startedWaiting = next.state === 'waiting' && current.state !== 'waiting'
      deps.emit({
        type: 'taskBoardRunsChanged',
        cardKeys: [next.cardKey],
        ...(startedWaiting && worktreeId && title
          ? { waiting: [{ cardKey: next.cardKey, worktreeId, title }] }
          : {})
      })
      return next
    },

    get(cardKey) {
      const mine = Object.values(deps.read()).filter((run) => run.cardKey === cardKey)
      return (
        mine.find(isTaskStartRunExclusive) ??
        mine.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ??
        null
      )
    },

    getById: (runId) => deps.read()[runId] ?? null,

    findByOrchestrator(match) {
      if (!match.sessionId && !match.handle && !match.paneKey) {
        return null
      }
      return (
        exclusive().find((run) => {
          const o = run.orchestrator
          return (
            run.launch === 'published' &&
            o !== undefined &&
            ((match.sessionId !== undefined && o.sessionId === match.sessionId) ||
              (match.handle !== undefined && o.handle === match.handle) ||
              (match.paneKey !== undefined && o.paneKey === match.paneKey))
          )
        }) ?? null
      )
    },

    listExclusive: exclusive,
    inFlight: new Set()
  }
}
