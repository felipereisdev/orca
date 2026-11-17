import { getManagedAccountPrimaryLabel } from '../../shared/agent-accounts/managed-account-display-names'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../shared/execution-host/execution-host'
import { findJiraIssueRepoCandidates } from '../../shared/jira/jira-project-reference'
import type { JiraIssue } from '../../shared/jira/jira-types'
import { findLinearProjectRepoCandidates } from '../../shared/linear/linear-project-reference'
import type { ClaudeManagedAccountSummary } from '../../shared/agent-accounts/managed-account-types'
import type { Repo } from '../../shared/repository/repo-types'
import {
  buildTaskStartAgentCatalog,
  type TaskStartAgentCatalogDeps
} from './task-start-agent-catalog'
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
import { isTaskBoardHostExecuted } from './task-board-host-repos'

export type TaskStartRepoCard = {
  ref: TaskBoardCardRef
  /** Jira only: the issue's project, which `defaultJiraProject` maps to a repo. */
  jiraIssue?: Pick<JiraIssue, 'project' | 'siteId'> | null
  /** Linear only: the issue's project, which `defaultLinearProject` maps to a repo. */
  linearProject?: TaskStartLinearIssueProject | null
}

export type TaskStartLinearIssueProject = { id: string; workspaceId: string | null }

export type TaskStartRepoResolution = { repoId: string } | { repoId: null; candidates: string[] }

export type TaskStartOptionsDeps = TaskStartAgentCatalogDeps & {
  /** This host's repos (local and SSH), never another Orca's. */
  repos(): Repo[]
  settings(): { taskStart: GlobalTaskStartSettings; defaultTuiAgent: TuiAgent | 'blank' | null }
  jiraIssue(
    key: string,
    siteId: string | null
  ): Promise<Pick<JiraIssue, 'project' | 'siteId'> | null>
  /** The Linear issue's project; null when the issue has none. */
  linearIssueProject(
    id: string,
    workspaceId: string | null
  ): Promise<TaskStartLinearIssueProject | null>
  baseRefDefault(repo: Repo): Promise<string | null>
}

function repoResolution(candidates: readonly Repo[]): TaskStartRepoResolution {
  return candidates.length === 1
    ? { repoId: candidates[0].id }
    : { repoId: null, candidates: candidates.map((repo) => repo.id) }
}

/** GitHub/GitLab cards name their repo; Jira and Linear map through the repo's default project. */
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
    return repoResolution(
      findJiraIssueRepoCandidates(repos, card.jiraIssue, LOCAL_EXECUTION_HOST_ID)
    )
  }
  if (ref.provider === 'linear' && card.linearProject) {
    // Host repos only, as for Jira: SSH repos use this host's Linear.
    const hostRepos = repos.filter((repo) => isTaskBoardHostExecuted(getRepoExecutionHostId(repo)))
    return repoResolution(findLinearProjectRepoCandidates(hostRepos, card.linearProject))
  }
  return { repoId: null, candidates: [] }
}

function accountName(account: ClaudeManagedAccountSummary): string {
  return getManagedAccountPrimaryLabel(account)
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
  const linearProject =
    ref.provider === 'linear'
      ? await deps.linearIssueProject(ref.id, ref.workspaceId).catch((error: unknown) => {
          console.warn('[task-start] Linear issue read failed:', error)
          return null
        })
      : null
  return resolveTaskStartRepo({ ref, jiraIssue, linearProject }, repos)
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
  // The pickers list this machine's providers; a remote project's limits are checked at ▶︎.
  const catalog = await buildTaskStartAgentCatalog(null, deps, repo)
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
