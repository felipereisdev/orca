import { acpListingNeedsChatFolder } from '../acp/discovery/acp-model-discovery-policy'
import { acpLaunchSpecFor } from '../acp/launch/acp-launch-registry'
import type { AgentSessionModelCatalogResult } from '../../shared/agent-session/agent-session-wire'
import type { AgentSessionModelOption } from '../../shared/agent-session/options/model-catalog/agent-session-model-option'
import type { Repo } from '../../shared/repository/repo-types'
import { getRepoMainWorktreeId } from '../../shared/worktree/id'
import { ALL_TUI_AGENTS } from '../../shared/agent-launch/catalog/tui-agent-display-names'
import { isTuiAgent } from '../../shared/agent-launch/catalog/tui-agent-config'
import { filterEnabledTuiAgents } from '../../shared/agent-launch/catalog/tui-agent-selection'
import { orderAgentLaunchPickerAgents } from '../../shared/agent-launch/picker/agent-launch-picker-rows'
import { getRepoExecutionHostId } from '../../shared/execution-host/execution-host'
import { getClaudeProfileRouter } from '../claude-accounts/profiles/routing/claude-profile-installed-router'
import { getIssue as getJiraIssue } from '../jira/jira-issue-read'
import { getIssue as getLinearIssue } from '../linear/issues/linear-issue-lookups'
import { agentCommandOverrideDetectionOptions } from '../preflight/installed-agent-detection'
import { detectAgentsOnHost } from '../preflight/workspace-agent-detection'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { claudeLaunchTargetForDetectionHost } from '../runtime/rpc/methods/accounts/workspace-accounts-snapshot'
import { isTaskBoardHostExecuted } from './task-board-host-repos'
import type { TaskStartOptionsDeps } from './task-start-options'

export type TaskStartOptionsRuntime = Pick<
  OrcaRuntimeService,
  | 'listRepos'
  | 'getClientSettings'
  | 'getRepoBaseRefDefault'
  | 'getClaudeAccountsSnapshot'
  | 'structuredAgentModelCatalog'
  | 'resolveAgentDetectionHost'
  | 'resolveStructuredAgentCatalogWorkspacePath'
>

/** Wires the start options to this host's settings, agent detection, accounts and saved catalogs. */
export function createTaskStartOptionsDeps(runtime: TaskStartOptionsRuntime): TaskStartOptionsDeps {
  const repos = () =>
    runtime.listRepos().filter((repo) => isTaskBoardHostExecuted(getRepoExecutionHostId(repo)))
  return {
    repos,
    settings: () => {
      const settings = runtime.getClientSettings()
      return { taskStart: settings.taskStart, defaultTuiAgent: settings.defaultTuiAgent }
    },
    jiraIssue: (key, siteId) => getJiraIssue(key, siteId, true),
    linearIssueProject: async (id, workspaceId) => {
      const issue = await getLinearIssue(id, workspaceId)
      return issue?.project
        ? { id: issue.project.id, workspaceId: issue.workspaceId ?? workspaceId }
        : null
    },
    baseRefDefault: async (repo) =>
      (await runtime.getRepoBaseRefDefault(`id:${repo.id}`)).defaultBaseRef,
    launchHost: async (repo) => {
      const settings = runtime.getClientSettings()
      // The new-workspace resolution: an SSH target, or local with the project's runtime (WSL).
      const host = await runtime.resolveAgentDetectionHost(undefined, repo?.id)
      let detected: string[]
      try {
        detected = await detectAgentsOnHost(host, {
          disabledTuiAgents: settings.disabledTuiAgents,
          ...agentCommandOverrideDetectionOptions(settings.agentCmdOverrides)
        })
      } catch (error) {
        if (!(host.kind === 'ssh' && error instanceof SshHostNotServedError)) {
          throw error
        }
        // This process never detects over SSH; the remote's launch reports a missing CLI itself.
        detected = [...ALL_TUI_AGENTS]
      }
      return {
        agents: orderAgentLaunchPickerAgents(
          settings.defaultTuiAgent,
          filterEnabledTuiAgents(detected.filter(isTuiAgent), settings.disabledTuiAgents)
        ),
        claudeAccountTarget: claudeLaunchTargetForDetectionHost(host)
      }
    },
    claudeAccounts: () => runtime.getClaudeAccountsSnapshot().accounts,
    modelCatalog: async (agent, accountId, repo) => {
      const catalog = await runtime.structuredAgentModelCatalog()
      if (!catalog) {
        return { origin: 'unknown' }
      }
      // Read-only: preparing the account's launch would set up its profile on every read.
      const account = accountId
        ? runtime
            .getClaudeAccountsSnapshot()
            .accounts.find((candidate) => candidate.id === accountId)
        : undefined
      const accountHome =
        account && (account.managedAuthRuntime ?? 'host') === 'host'
          ? getClaudeProfileRouter()?.accountHome(account.id)
          : undefined
      if (accountId && !accountHome) {
        // No read-only home (WSL account, or a host without profiles): the picker's seeds apply.
        return { origin: 'unknown' }
      }
      const readSaved = (workspacePath?: string) =>
        catalog.prepareSaved({
          agent,
          savedOnly: true,
          ...(workspacePath ? { workspacePath } : {}),
          ...(accountHome
            ? {
                claudeAccountId: accountId,
                accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: accountHome }
              }
            : {})
        })
      if (!catalogKeptPerFolder(agent)) {
        return readSaved()
      }
      // Its chats save a list per folder and none for the account: read the repo's own, else
      // what this host's repos have saved.
      const folderOf = (candidate: Repo) =>
        runtime.resolveStructuredAgentCatalogWorkspacePath(getRepoMainWorktreeId(candidate))
      const own = repo ? await folderOf(repo) : null
      if (own) {
        const saved = await readSaved(own)
        if (saved.origin !== 'unknown') {
          return saved
        }
      }
      const folders = await Promise.all(repos().map(folderOf))
      const others = new Set(folders.filter((folder): folder is string => folder !== null))
      others.delete(own ?? '')
      return mergeFolderCatalogs(await Promise.all([...others].map((folder) => readSaved(folder))))
    }
  }
}

/** Agents whose model list depends on the chat's folder (OpenCode) are listed only in one. */
function catalogKeptPerFolder(agent: string): boolean {
  const spec = acpLaunchSpecFor(agent)
  return spec !== null && acpListingNeedsChatFolder(spec.modelDiscovery)
}

/** Every folder's models, newest list first; no folder's default holds for the others. */
function mergeFolderCatalogs(
  results: readonly AgentSessionModelCatalogResult[]
): AgentSessionModelCatalogResult {
  const listed = results
    .flatMap((result) => (result.origin === 'unknown' ? [] : [result]))
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
  if (listed.length === 0) {
    return { origin: 'unknown' }
  }
  const models = new Map<string, AgentSessionModelOption>()
  for (const model of listed.flatMap((result) => result.models)) {
    if (!models.has(model.id)) {
      models.set(model.id, { ...model, isDefault: false })
    }
  }
  return {
    origin: listed[0].origin,
    fetchedAt: listed[0].fetchedAt,
    models: [...models.values()],
    modelsDifferByWorkspace: true
  }
}
