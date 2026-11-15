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

export type TaskStartAgentCatalogDeps = {
  /** Agents installed and not disabled where the repo's terminals run. */
  enabledAgents(repo: Repo): Promise<TuiAgent[]>
  claudeAccounts(): ClaudeManagedAccountSummary[]
  claudeAccountTarget(repo: Repo): ClaudeAccountLaunchTarget
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
  repo: Repo,
  deps: TaskStartAgentCatalogDeps
): Promise<TaskStartAgentCatalogEntry[]> {
  const agents = await deps.enabledAgents(repo)
  // The SSH launch path refuses managed accounts; the remote's own login runs.
  const accounts =
    getRepoSshConnectionId(repo) === null
      ? filterClaudeAccountsForLaunchTarget(deps.claudeAccounts(), deps.claudeAccountTarget(repo))
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

async function resolveRepoId(
  params: { ref?: TaskBoardCardRef; repoId?: string },
  repos: readonly Repo[],
  deps: TaskStartOptionsDeps
): Promise<string | null> {
  if (params.repoId) {
    return repos.some((repo) => repo.id === params.repoId) ? params.repoId : null
  }
  if (!params.ref) {
    return null
  }
  const ref = params.ref
  const jiraIssue =
    ref.provider === 'jira' ? await deps.jiraIssue(ref.key, ref.siteId).catch(() => null) : null
  return resolveTaskStartRepo({ ref, jiraIssue }, repos).repoId
}

function roleLabels(
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
  const repoId = await resolveRepoId(params, repos, deps)
  const repo = repos.find((candidate) => candidate.id === repoId)
  if (!repo) {
    return {
      repoId: null,
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
  const labels = roles ? roleLabels(roles, accounts) : null
  const invalidRoles = roles
    ? TASK_START_ROLES.filter(
        (role) =>
          !catalog.some(
            (entry) =>
              entry.agent === roles[role].agent && entry.accountId === roles[role].accountId
          )
      )
    : []
  return {
    repoId: repo.id,
    repos: list,
    workspaceMode: resolveTaskStartWorkspaceMode(repo),
    baseRef,
    roles,
    labels,
    catalog,
    invalidRoles
  }
}
