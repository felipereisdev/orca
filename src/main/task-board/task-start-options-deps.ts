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
  | 'getAccountsSnapshot'
  | 'structuredAgentModelCatalog'
  | 'resolveAgentDetectionHost'
>

/** Wires the start options to this host's settings, agent detection, accounts and saved catalogs. */
export function createTaskStartOptionsDeps(runtime: TaskStartOptionsRuntime): TaskStartOptionsDeps {
  return {
    repos: () =>
      runtime.listRepos().filter((repo) => isTaskBoardHostExecuted(getRepoExecutionHostId(repo))),
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
    claudeAccounts: () => runtime.getAccountsSnapshot().claude.accounts,
    modelCatalog: async (agent, accountId) => {
      const catalog = await runtime.structuredAgentModelCatalog()
      if (!catalog) {
        return { origin: 'unknown' }
      }
      // Read-only: preparing the account's launch would set up its profile on every read.
      const account = accountId
        ? runtime
            .getAccountsSnapshot()
            .claude.accounts.find((candidate) => candidate.id === accountId)
        : undefined
      const accountHome =
        account && (account.managedAuthRuntime ?? 'host') === 'host'
          ? getClaudeProfileRouter()?.accountHome(account.id)
          : undefined
      if (accountId && !accountHome) {
        // No read-only home (WSL account, or a host without profiles): the picker's seeds apply.
        return { origin: 'unknown' }
      }
      // `read` answers only a scope this process already bound; startup binds Claude's and Codex's
      // (prewarm) but never OpenCode's, whose saved list then read as unknown with no seed models.
      return catalog.prepareSaved({
        agent,
        savedOnly: true,
        ...(accountHome
          ? {
              claudeAccountId: accountId,
              accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: accountHome }
            }
          : {})
      })
    }
  }
}
