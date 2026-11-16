import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import { tuiAgentDisplayName } from '../../shared/agent-launch/catalog/tui-agent-display-names'
import {
  agentPickerEntryOptions,
  agentPickerModels
} from '../../shared/agent-launch/picker/agent-launch-picker-catalog'
import type { AgentSessionModelCatalogResult } from '../../shared/agent-session/agent-session-wire'
import {
  filterClaudeAccountsForLaunchTarget,
  type ClaudeAccountLaunchTarget
} from '../../shared/claude-account-launch-target'
import { getRepoSshConnectionId, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { findJiraIssueRepoCandidates } from '../../shared/jira/jira-project-reference'
import type { JiraIssue } from '../../shared/jira/jira-types'
import type { ClaudeManagedAccountSummary } from '../../shared/managed-account-types'
import type { Repo } from '../../shared/repo-types'
import type {
  TaskBoardCardRef,
  TaskStartAgentCatalogEntry,
  TaskStartOptionsResult
} from '../../shared/task-board/task-board-wire-types'
import { taskStartRoleLabel } from '../../shared/task-board/task-start-prompt'
import {
  resolveTaskStartRoles,
  resolveTaskStartWorkspaceMode,
  TASK_START_ROLES,
  type GlobalTaskStartSettings,
  type TaskStartAgentChoice,
  type TaskStartRole
} from '../../shared/task-board/task-start-settings'

export type TaskStartRepoCard = {
  ref: TaskBoardCardRef
  /** Jira only: the issue's project, which `defaultJiraProject` maps to a repo. */
  jiraIssue?: Pick<JiraIssue, 'project' | 'siteId'> | null
}

export type TaskStartRepoResolution = { repoId: string } | { repoId: null; candidates: string[] }

export type TaskStartLaunchHost = {
  /** Agents installed and not disabled where the repo's terminals run. */
  agents: TuiAgent[]
  /** Where a managed Claude account would launch; null offers no accounts (SSH or unknown). */
  claudeAccountTarget: ClaudeAccountLaunchTarget | null
}

export type TaskStartAgentCatalogDeps = {
  /** `null`: no repo is named (the global settings), so this host's own terminals. */
  launchHost(repo: Repo | null): Promise<TaskStartLaunchHost>
  claudeAccounts(): ClaudeManagedAccountSummary[]
  /** The host's saved catalog only; never opens a session or starts a listing. */
  modelCatalog(agent: TuiAgent, accountId?: string): Promise<AgentSessionModelCatalogResult>
}

export type TaskStartOptionsDeps = TaskStartAgentCatalogDeps & {
  /** This host's repos (local and SSH), never another Orca's. */
  repos(): Repo[]
  settings(): { taskStart: GlobalTaskStartSettings; defaultTuiAgent: TuiAgent | 'blank' | null }
  jiraIssue(
    key: string,
    siteId: string | null
  ): Promise<Pick<JiraIssue, 'project' | 'siteId'> | null>
  baseRefDefault(repo: Repo): Promise<string | null>
}

/** GitHub/GitLab cards name their repo; Jira maps through `defaultJiraProject`; Linear has no mapping. */
export function resolveTaskStartRepo(
  card: TaskStartRepoCard,
  repos: readonly Repo[]
): TaskStartRepoResolution {
  const { ref } = card
  if (ref.provider === 'github' || ref.provider === 'gitlab') {
    return repos.some((repo) => repo.id === ref.repoId)
      ? { repoId: ref.repoId }
      : { repoId: null, candidates: [] }
  }
  if (ref.provider === 'jira' && card.jiraIssue) {
    // Host repos only: SSH repos map to this host's Jira, like local ones.
    const candidates = findJiraIssueRepoCandidates(repos, card.jiraIssue, LOCAL_EXECUTION_HOST_ID)
    return candidates.length === 1
      ? { repoId: candidates[0].id }
      : { repoId: null, candidates: candidates.map((repo) => repo.id) }
  }
  return { repoId: null, candidates: [] }
}

async function catalogModels(
  agent: TuiAgent,
  accountId: string | undefined,
  deps: TaskStartAgentCatalogDeps
): Promise<TaskStartAgentCatalogEntry['models']> {
  const catalog = await deps
    .modelCatalog(agent, accountId)
    .catch((): AgentSessionModelCatalogResult => ({ origin: 'unknown' }))
  const entry = { agent, catalog, terminal: {} }
  // Workers launch as terminals, so the terminal picker's rows and effort options apply.
  return agentPickerModels(entry, 'terminal')
    .filter((model) => model.id && !model.hidden)
    .map((model) => {
      const effort = agentPickerEntryOptions(entry, model.id, 'terminal').find(
        (option) => option.category === 'thought_level'
      )
      return {
        id: model.id,
        label: model.label,
        efforts:
          effort?.kind.type === 'select'
            ? effort.kind.choices.map((choice) => ({ id: choice.value, label: choice.label }))
            : []
      }
    })
}

function accountName(account: ClaudeManagedAccountSummary): string {
  return account.label || account.email
}

/** One source for desktop and mobile: this host's agents, accounts and saved model catalogs. */
export async function buildTaskStartAgentCatalog(
  repo: Repo | null,
  deps: TaskStartAgentCatalogDeps
): Promise<TaskStartAgentCatalogEntry[]> {
  const { agents, claudeAccountTarget } = await deps.launchHost(repo)
  // The SSH launch path refuses managed accounts; the remote's own login runs.
  const accounts =
    (repo === null || getRepoSshConnectionId(repo) === null) && claudeAccountTarget
      ? filterClaudeAccountsForLaunchTarget(deps.claudeAccounts(), claudeAccountTarget)
      : []
  const entries = await Promise.all(
    agents.map(async (agent) => {
      const base: TaskStartAgentCatalogEntry = {
        agent,
        label: tuiAgentDisplayName(agent) ?? agent,
        models: await catalogModels(agent, undefined, deps)
      }
      if (agent !== 'claude') {
        return [base]
      }
      const variants = await Promise.all(
        accounts.map(async (account): Promise<TaskStartAgentCatalogEntry> => ({
          agent,
          accountId: account.id,
          label: `Claude (${accountName(account)})`,
          ...(account.needsSignIn ? { needsSignIn: true as const } : {}),
          models: await catalogModels(agent, account.id, deps)
        }))
      )
      return [base, ...variants]
    })
  )
  return entries.flat()
}

/** An explicit `repoId` wins; otherwise the card's own mapping. */
export async function resolveTaskStartRepoForParams(
  params: { ref?: TaskBoardCardRef; repoId?: string },
  repos: readonly Repo[],
  deps: TaskStartOptionsDeps
): Promise<TaskStartRepoResolution> {
  if (params.repoId) {
    return repos.some((repo) => repo.id === params.repoId)
      ? { repoId: params.repoId }
      : { repoId: null, candidates: [] }
  }
  if (!params.ref) {
    return { repoId: null, candidates: [] }
  }
  const ref = params.ref
  // An unreadable issue leaves the repo for the user to pick.
  const jiraIssue =
    ref.provider === 'jira' ? await deps.jiraIssue(ref.key, ref.siteId).catch(() => null) : null
  return resolveTaskStartRepo({ ref, jiraIssue }, repos)
}

/** Unknown agent/account, model or effort; an empty model list (unreadable catalog) checks only the agent. */
function isChoiceInCatalog(
  choice: TaskStartAgentChoice,
  catalog: readonly TaskStartAgentCatalogEntry[]
): boolean {
  const entry = catalog.find(
    (candidate) => candidate.agent === choice.agent && candidate.accountId === choice.accountId
  )
  if (!entry) {
    return false
  }
  if (!choice.model || entry.models.length === 0) {
    return true
  }
  const model = entry.models.find((candidate) => candidate.id === choice.model)
  if (!model) {
    return false
  }
  return !choice.effort || model.efforts.some((effort) => effort.id === choice.effort)
}

/** Roles whose agent/account, model or effort the repo's catalog does not offer. */
export function invalidTaskStartRoles(
  roles: Record<TaskStartRole, TaskStartAgentChoice>,
  catalog: readonly TaskStartAgentCatalogEntry[]
): TaskStartRole[] {
  return TASK_START_ROLES.filter((role) => !isChoiceInCatalog(roles[role], catalog))
}

export function taskStartRoleLabels(
  roles: Record<TaskStartRole, TaskStartAgentChoice>,
  accounts: ReadonlyMap<string, ClaudeManagedAccountSummary>
): Record<TaskStartRole, string> {
  const label = (role: TaskStartRole) => {
    const { accountId } = roles[role]
    const account = accountId ? accounts.get(accountId) : undefined
    return taskStartRoleLabel(roles[role], account ? accountName(account) : undefined)
  }
  return {
    orchestrator: label('orchestrator'),
    planner: label('planner'),
    planReviewer: label('planReviewer'),
    implementer: label('implementer'),
    reviewer: label('reviewer'),
    qa: label('qa')
  }
}

/** Defaults for "Iniciar como…" and the settings screens; without a ref or repo, only the repo list. */
export async function getTaskStartOptions(
  params: { ref?: TaskBoardCardRef; repoId?: string },
  deps: TaskStartOptionsDeps
): Promise<TaskStartOptionsResult> {
  const repos = deps.repos()
  const list = repos.map((repo) => ({
    id: repo.id,
    label: repo.displayName,
    kind: repo.kind === 'folder' ? ('folder' as const) : ('git' as const)
  }))
  if (!params.ref && !params.repoId) {
    return globalTaskStartOptions(list, deps)
  }
  const resolution = await resolveTaskStartRepoForParams(params, repos, deps)
  const repo = repos.find((candidate) => candidate.id === resolution.repoId)
  if (!repo) {
    return {
      repoId: null,
      repoCandidates: resolution.repoId === null ? resolution.candidates : [],
      repos: list,
      workspaceMode: 'worktree',
      baseRef: null,
      roles: null,
      labels: null,
      catalog: [],
      invalidRoles: []
    }
  }
  const settings = deps.settings()
  const roles = resolveTaskStartRoles({
    global: settings.taskStart,
    repo: repo.taskStart,
    defaultAgent: settings.defaultTuiAgent
  })
  // Folder repos never consult git.
  const baseRef =
    repo.kind === 'folder'
      ? null
      : (repo.worktreeBaseRef ?? (await deps.baseRefDefault(repo).catch(() => null)))
  const catalog = await buildTaskStartAgentCatalog(repo, deps)
  const accounts = new Map(deps.claudeAccounts().map((account) => [account.id, account]))
  const labels = roles ? taskStartRoleLabels(roles, accounts) : null
  const invalidRoles = roles ? invalidTaskStartRoles(roles, catalog) : []
  return {
    repoId: repo.id,
    repoCandidates: [],
    repos: list,
    workspaceMode: resolveTaskStartWorkspaceMode(repo),
    baseRef,
    roles,
    labels,
    catalog,
    invalidRoles
  }
}

/** The global settings name no repo: this host's agents and accounts, and the global roles. */
async function globalTaskStartOptions(
  repos: TaskStartOptionsResult['repos'],
  deps: TaskStartOptionsDeps
): Promise<TaskStartOptionsResult> {
  const settings = deps.settings()
  const roles = resolveTaskStartRoles({
    global: settings.taskStart,
    defaultAgent: settings.defaultTuiAgent
  })
  const catalog = await buildTaskStartAgentCatalog(null, deps)
  const accounts = new Map(deps.claudeAccounts().map((account) => [account.id, account]))
  return {
    repoId: null,
    repoCandidates: [],
    repos,
    workspaceMode: 'worktree',
    baseRef: null,
    roles,
    labels: roles ? taskStartRoleLabels(roles, accounts) : null,
    catalog,
    invalidRoles: roles ? invalidTaskStartRoles(roles, catalog) : []
  }
}
