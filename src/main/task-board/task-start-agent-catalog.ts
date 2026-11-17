import { getManagedAccountPrimaryLabel } from '../../shared/agent-accounts/managed-account-display-names'
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
} from '../../shared/agent-accounts/claude/claude-account-launch-target'
import { getRepoSshConnectionId } from '../../shared/execution-host/execution-host'
import type { ClaudeManagedAccountSummary } from '../../shared/agent-accounts/managed-account-types'
import type { Repo } from '../../shared/repository/repo-types'
import type { TaskStartAgentCatalogEntry } from '../../shared/task-board/task-board-wire-types'

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
  /** The host's saved catalog for a task in `repo` (null: any of this host's repos); never opens a
   *  session or starts a listing. */
  modelCatalog(
    agent: TuiAgent,
    accountId: string | undefined,
    repo: Repo | null
  ): Promise<AgentSessionModelCatalogResult>
}

async function catalogModels(
  agent: TuiAgent,
  accountId: string | undefined,
  repo: Repo | null,
  deps: TaskStartAgentCatalogDeps
): Promise<TaskStartAgentCatalogEntry['models']> {
  const catalog = await deps
    .modelCatalog(agent, accountId, repo)
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

/** One source for desktop and mobile: this host's agents, accounts and saved model catalogs.
 *  `repo` picks the launch host; `catalogRepo` the project whose saved model lists apply. */
export async function buildTaskStartAgentCatalog(
  repo: Repo | null,
  deps: TaskStartAgentCatalogDeps,
  catalogRepo: Repo | null = repo
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
        models: await catalogModels(agent, undefined, catalogRepo, deps)
      }
      if (agent !== 'claude') {
        return [base]
      }
      const variants = await Promise.all(
        accounts.map(async (account): Promise<TaskStartAgentCatalogEntry> => ({
          agent,
          accountId: account.id,
          label: `Claude (${getManagedAccountPrimaryLabel(account)})`,
          ...(account.needsSignIn ? { needsSignIn: true as const } : {}),
          models: await catalogModels(agent, account.id, catalogRepo, deps)
        }))
      )
      return [base, ...variants]
    })
  )
  return entries.flat()
}
