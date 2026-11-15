import { ALL_TUI_AGENTS } from '../../shared/agent-launch/catalog/tui-agent-display-names'
import { isTuiAgent } from '../../shared/agent-launch/catalog/tui-agent-config'
import { filterEnabledTuiAgents } from '../../shared/agent-launch/catalog/tui-agent-selection'
import { orderAgentLaunchPickerAgents } from '../../shared/agent-launch/picker/agent-launch-picker-rows'
import { getRepoExecutionHostId, getRepoSshConnectionId } from '../../shared/execution-host'
import { resolveWslSessionContext } from '../daemon/pty-subprocess/wsl-session-context'
import { getIssue as getJiraIssue } from '../jira/jira-issue-read'
import { agentCommandOverrideDetectionOptions } from '../preflight/installed-agent-detection'
import { detectAgentsOnHost } from '../preflight/workspace-agent-detection'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { isTaskBoardHostExecuted } from './task-board-host-repos'
import type { TaskStartOptionsDeps } from './task-start-options'

export type TaskStartOptionsRuntime = Pick<
  OrcaRuntimeService,
  | 'listRepos'
  | 'getClientSettings'
  | 'getRepoBaseRefDefault'
  | 'getAccountsSnapshot'
  | 'structuredAgentModelCatalog'
  | 'prepareClaudeAccountLaunch'
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
    baseRefDefault: async (repo) =>
      (await runtime.getRepoBaseRefDefault(`id:${repo.id}`)).defaultBaseRef,
    enabledAgents: async (repo) => {
      const settings = runtime.getClientSettings()
      const connectionId = getRepoSshConnectionId(repo)
      // Same detection as a new workspace's agent; a host that cannot detect offers every enabled agent.
      const detected: string[] = await detectAgentsOnHost(
        connectionId ? { kind: 'ssh', connectionId } : { kind: 'local' },
        {
          disabledTuiAgents: settings.disabledTuiAgents,
          ...agentCommandOverrideDetectionOptions(settings.agentCmdOverrides)
        }
      ).catch(() => [...ALL_TUI_AGENTS])
      return orderAgentLaunchPickerAgents(
        settings.defaultTuiAgent,
        filterEnabledTuiAgents(detected.filter(isTuiAgent), settings.disabledTuiAgents)
      )
    },
    claudeAccounts: () => runtime.getAccountsSnapshot().claude.accounts,
    claudeAccountTarget: (repo) => {
      const wsl = resolveWslSessionContext({ cwd: repo.path })
      return wsl ? { runtime: 'wsl', wslDistro: wsl.distro } : { runtime: 'host', wslDistro: null }
    },
    modelCatalog: async (agent, accountId) => {
      const catalog = await runtime.structuredAgentModelCatalog()
      if (!catalog) {
        return { origin: 'unknown' }
      }
      // As agentSession.modelCatalog with savedOnly: an explicit account reads its own home's catalog.
      const account = accountId ? await runtime.prepareClaudeAccountLaunch(accountId) : undefined
      return catalog.read({
        agent,
        savedOnly: true,
        ...(account
          ? {
              claudeAccountId: accountId,
              accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: account.configDir }
            }
          : {})
      })
    }
  }
}
