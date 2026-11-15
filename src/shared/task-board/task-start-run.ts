import { ALL_TUI_AGENTS } from '../agent-launch/catalog/tui-agent-display-names'
import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { TaskStartWorkspaceMode } from './task-start-settings'

export const TASK_START_PHASES = [
  'starting',
  'planning',
  'plan-review',
  'qa-script',
  'development',
  'final-review',
  'qa',
  'completed'
] as const
export type TaskStartPhase = (typeof TASK_START_PHASES)[number]

export type TaskStartRunState =
  | 'running'
  | 'waiting'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'

export type TaskStartProgress = {
  current: number
  total: number
  step?: 'implementing' | 'reviewing'
}

export type TaskStartOrchestratorRef = {
  hostId: string
  agent: TuiAgent
  worktreeId: string
  surface: 'terminal' | 'chat'
  handle?: string
  paneKey?: string
  tabId?: string
  sessionId?: string
}

export type TaskStartFailure =
  | 'orchestrator-exited'
  | 'launch-failed'
  | 'context-fetch-failed'
  | 'worktree-create-failed'
  | 'prompt-unconfirmed'
  | 'stop-unconfirmed'
  | 'cancelled'

export type TaskStartRun = {
  id: string
  cardKey: string
  repoId: string
  workspaceMode: TaskStartWorkspaceMode
  /** `${repoId}` in primary mode. */
  primaryKey?: string
  launch: 'pending' | 'published'
  /** Set as soon as the worktree exists, before the orchestrator surface is published. */
  worktreeId?: string
  orchestrator?: TaskStartOrchestratorRef
  state: TaskStartRunState
  phase: TaskStartPhase
  progress?: TaskStartProgress
  note?: string
  failure?: TaskStartFailure
  startedAt: string
  updatedAt: string
}

export type TaskStartRunSummary = Pick<
  TaskStartRun,
  | 'id'
  | 'state'
  | 'phase'
  | 'progress'
  | 'note'
  | 'failure'
  | 'orchestrator'
  | 'worktreeId'
  | 'updatedAt'
> & { percent: number }

export const MAX_TASK_START_RUNS = 500
const MAX_STRING_LENGTH = 2000

const PHASE_PERCENT: Record<Exclude<TaskStartPhase, 'development'>, number> = {
  starting: 0,
  planning: 10,
  'plan-review': 20,
  'qa-script': 25,
  'final-review': 85,
  qa: 92,
  completed: 100
}
const DEVELOPMENT_START = 30
const DEVELOPMENT_END = 80

export function taskStartPercent(phase: TaskStartPhase, progress?: TaskStartProgress): number {
  if (phase !== 'development') {
    return PHASE_PERCENT[phase]
  }
  if (!progress || !(progress.total > 0)) {
    return DEVELOPMENT_START
  }
  const ratio = Math.min(1, Math.max(0, progress.current / progress.total))
  return Math.round(DEVELOPMENT_START + ratio * (DEVELOPMENT_END - DEVELOPMENT_START))
}

export function summarizeTaskStartRun(run: TaskStartRun): TaskStartRunSummary {
  return {
    id: run.id,
    state: run.state,
    phase: run.phase,
    progress: run.progress,
    note: run.note,
    failure: run.failure,
    orchestrator: run.orchestrator,
    worktreeId: run.worktreeId,
    updatedAt: run.updatedAt,
    percent: taskStartPercent(run.phase, run.progress)
  }
}

export function isTaskStartRunExclusive(run: Pick<TaskStartRun, 'state'>): boolean {
  return run.state === 'running' || run.state === 'waiting' || run.state === 'stopping'
}

const STATES: ReadonlySet<string> = new Set([
  'running',
  'waiting',
  'stopping',
  'stopped',
  'completed',
  'failed'
])
const PHASES: ReadonlySet<string> = new Set(TASK_START_PHASES)
const FAILURES: ReadonlySet<string> = new Set([
  'orchestrator-exited',
  'launch-failed',
  'context-fetch-failed',
  'worktree-create-failed',
  'prompt-unconfirmed',
  'stop-unconfirmed',
  'cancelled'
])
const AGENTS: ReadonlySet<string> = new Set(ALL_TUI_AGENTS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, MAX_STRING_LENGTH)
    : undefined
}

function normalizeProgress(value: unknown): TaskStartProgress | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const { current, total, step } = value
  if (
    typeof current !== 'number' ||
    typeof total !== 'number' ||
    !Number.isFinite(current) ||
    !Number.isFinite(total)
  ) {
    return undefined
  }
  const progress: TaskStartProgress = { current, total }
  if (step === 'implementing' || step === 'reviewing') {
    progress.step = step
  }
  return progress
}

function normalizeOrchestrator(value: unknown): TaskStartOrchestratorRef | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const hostId = str(value.hostId)
  const worktreeId = str(value.worktreeId)
  const agent = str(value.agent)
  if (
    !hostId ||
    !worktreeId ||
    !agent ||
    !AGENTS.has(agent) ||
    (value.surface !== 'terminal' && value.surface !== 'chat')
  ) {
    return undefined
  }
  const ref: TaskStartOrchestratorRef = {
    hostId,
    agent: agent as TuiAgent,
    worktreeId,
    surface: value.surface
  }
  for (const key of ['handle', 'paneKey', 'tabId', 'sessionId'] as const) {
    const v = str(value[key])
    if (v) {
      ref[key] = v
    }
  }
  return ref
}

function normalizeRun(value: unknown): TaskStartRun | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const id = str(value.id)
  const cardKey = str(value.cardKey)
  const repoId = str(value.repoId)
  const startedAt = str(value.startedAt)
  const updatedAt = str(value.updatedAt)
  if (
    !id ||
    !cardKey ||
    !repoId ||
    !startedAt ||
    !updatedAt ||
    (value.workspaceMode !== 'worktree' && value.workspaceMode !== 'primary') ||
    (value.launch !== 'pending' && value.launch !== 'published') ||
    typeof value.state !== 'string' ||
    !STATES.has(value.state) ||
    typeof value.phase !== 'string' ||
    !PHASES.has(value.phase)
  ) {
    return undefined
  }
  const run: TaskStartRun = {
    id,
    cardKey,
    repoId,
    workspaceMode: value.workspaceMode,
    launch: value.launch,
    state: value.state as TaskStartRunState,
    phase: value.phase as TaskStartPhase,
    startedAt,
    updatedAt
  }
  const primaryKey = str(value.primaryKey)
  if (primaryKey) {
    run.primaryKey = primaryKey
  }
  const worktreeId = str(value.worktreeId)
  if (worktreeId) {
    run.worktreeId = worktreeId
  }
  const orchestrator = normalizeOrchestrator(value.orchestrator)
  if (orchestrator) {
    run.orchestrator = orchestrator
  }
  const progress = normalizeProgress(value.progress)
  if (progress) {
    run.progress = progress
  }
  const note = str(value.note)
  if (note) {
    run.note = note
  }
  if (typeof value.failure === 'string' && FAILURES.has(value.failure)) {
    run.failure = value.failure as TaskStartFailure
  }
  if (run.launch === 'pending') {
    // A pending launch loaded from disk means the previous process died mid-start.
    run.state = 'failed'
    run.failure = 'launch-failed'
  }
  return run
}

export function normalizeTaskStartRuns(value: unknown): Record<string, TaskStartRun> {
  const entries: [string, TaskStartRun][] = []
  if (isRecord(value)) {
    for (const [key, raw] of Object.entries(value)) {
      const run = normalizeRun(raw)
      if (run) {
        entries.push([key, run])
      }
    }
  }
  if (entries.length > MAX_TASK_START_RUNS) {
    const evictable = entries
      .filter(([, run]) => !isTaskStartRunExclusive(run))
      .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt))
    const drop = new Set(
      evictable.slice(0, entries.length - MAX_TASK_START_RUNS).map(([key]) => key)
    )
    return Object.fromEntries(entries.filter(([key]) => !drop.has(key)))
  }
  return Object.fromEntries(entries)
}
