import { ALL_TUI_AGENTS } from '../agent-launch/catalog/tui-agent-display-names'
import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { Repo } from '../repository/repo-types'

export const TASK_START_ROLES = [
  'orchestrator',
  'planner',
  'planReviewer',
  'implementer',
  'reviewer',
  'qa'
] as const
export type TaskStartRole = (typeof TASK_START_ROLES)[number]

export type TaskStartAgentChoice = {
  agent: TuiAgent
  accountId?: string
  model?: string
  effort?: string
}
export type TaskStartRoles = Partial<Record<TaskStartRole, TaskStartAgentChoice>>
export type TaskStartWorkspaceMode = 'worktree' | 'primary'
export type GlobalTaskStartSettings = { roles: TaskStartRoles }
export type RepoTaskStartSettings = {
  workspaceMode?: TaskStartWorkspaceMode
  roles?: TaskStartRoles
}

const MAX_VALUE_LENGTH = 200
const ACCOUNT_AGENT: TuiAgent = 'claude'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_VALUE_LENGTH) : ''
}

function normalizeChoice(value: unknown): TaskStartAgentChoice | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const agent = ALL_TUI_AGENTS.find((candidate) => candidate === cleanString(value.agent))
  if (!agent) {
    return undefined
  }
  const choice: TaskStartAgentChoice = { agent }
  const accountId = cleanString(value.accountId)
  if (accountId && agent === ACCOUNT_AGENT) {
    choice.accountId = accountId
  }
  const model = cleanString(value.model)
  if (model) {
    choice.model = model
    const effort = cleanString(value.effort)
    if (effort) {
      choice.effort = effort
    }
  }
  return choice
}

export function normalizeTaskStartRoles(value: unknown): TaskStartRoles {
  const roles: TaskStartRoles = {}
  if (!isRecord(value)) {
    return roles
  }
  for (const role of TASK_START_ROLES) {
    const choice = normalizeChoice(value[role])
    if (choice) {
      roles[role] = choice
    }
  }
  return roles
}

export function getDefaultGlobalTaskStartSettings(): GlobalTaskStartSettings {
  return { roles: {} }
}

export function normalizeGlobalTaskStartSettings(value: unknown): GlobalTaskStartSettings {
  const raw = isRecord(value) ? value : {}
  return { roles: normalizeTaskStartRoles(raw.roles) }
}

export function normalizeRepoTaskStartSettings(value: unknown): RepoTaskStartSettings | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const settings: RepoTaskStartSettings = {}
  if (value.workspaceMode === 'worktree' || value.workspaceMode === 'primary') {
    settings.workspaceMode = value.workspaceMode
  }
  const roles = normalizeTaskStartRoles(value.roles)
  if (Object.keys(roles).length > 0) {
    settings.roles = roles
  }
  return Object.keys(settings).length > 0 ? settings : undefined
}

export function resolveTaskStartRoles(args: {
  global: GlobalTaskStartSettings
  repo?: RepoTaskStartSettings
  defaultAgent: TuiAgent | 'blank' | null
  overrides?: TaskStartRoles
}): Record<TaskStartRole, TaskStartAgentChoice> | null {
  const { global, repo, defaultAgent, overrides } = args
  const pick = (role: TaskStartRole): TaskStartAgentChoice | undefined =>
    overrides?.[role] ?? repo?.roles?.[role] ?? global.roles[role]
  let orchestrator = pick('orchestrator')
  if (!orchestrator) {
    if (defaultAgent === null || defaultAgent === 'blank') {
      return null
    }
    orchestrator = { agent: defaultAgent }
  }
  const fallback = orchestrator
  const choiceFor = (role: TaskStartRole): TaskStartAgentChoice => pick(role) ?? fallback
  return {
    orchestrator: fallback,
    planner: choiceFor('planner'),
    planReviewer: choiceFor('planReviewer'),
    implementer: choiceFor('implementer'),
    reviewer: choiceFor('reviewer'),
    qa: choiceFor('qa')
  }
}

export function resolveTaskStartWorkspaceMode(
  repo: Pick<Repo, 'kind' | 'taskStart'>,
  override?: TaskStartWorkspaceMode
): TaskStartWorkspaceMode {
  if (repo.kind === 'folder') {
    return 'primary'
  }
  return override ?? repo.taskStart?.workspaceMode ?? 'worktree'
}
