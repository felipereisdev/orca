import type { StructuredAgentId } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { structuredAgentRuntimeMetadata } from '../agent-session/installation/structured-agent-runtime-metadata'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { resolveHostStructuredAgentLaunchEnvironment } from '../agent-session/launch/structured-agent-launch-support'
import { agentWorkspaceTrustDecisionForWorkspace } from '../../agent-launch/trust/agent-workspace-trust-spawn'
import { OrcaRuntimeWithStructuredSessionCliWriterHost } from './structured-session-cli-writer-host'
import type { AgentSessionAccountHome } from '../../../shared/agent-session/lifecycle/agent-session-account-home'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionRefusalError } from '../../../shared/agent-session/failures/agent-session-wire-refusals'

export abstract class OrcaRuntimeWithStructuredSessionAccountHome extends OrcaRuntimeWithStructuredSessionCliWriterHost {
  /** Resolve account home through this host's agent registration; null means unregistered and create refuses. */
  protected structuredAgentAccountHomeResolver(
    agent: StructuredAgentId,
    worktree: string,
    purpose: 'launch' | 'read' | 'identity',
    hostLaunchDirectory?: string
  ) {
    const registration = structuredAgentRuntimeMetadata(agent)
    if (!registration) {
      return null
    }
    return async ({ launchEnv, location }, permissionMode?: string) =>
      registration.resolveAccountHome(
        {
          launchEnv,
          location: location ?? null,
          purpose,
          ...(permissionMode ? { permissionMode } : {}),
          workspacePath:
            purpose === 'launch'
              ? async () =>
                  hostLaunchDirectory ??
                  (await this.resolveRuntimeFileTarget(worktree)).worktree.path
              : null
        },
        {
          getClaudeConfigDirectory: (target) => this.accounts.getClaudeConfigDirectory(target),
          prepareCodexLaunchHome: this.prepareCodexStructuredLaunchFn,
          readCodexLaunchHome: this.resolveCodexStructuredLaunchHomeFn,
          workspaceTrustSettings: () => this.requireStore().getSettings(),
          workspaceTrustRepoDecision: (launchLocation) =>
            launchLocation?.workspaceKind === 'folder'
              ? undefined
              : agentWorkspaceTrustDecisionForWorkspace(
                  launchLocation?.workspaceId,
                  this.requireStore()
                ),
          // The chat host's own state root (ensureStructuredAgentSessionHost).
          stateDirectory: getProfileUserDataPath(),
          hostLaunchEnvironment: (agent) =>
            resolveHostStructuredAgentLaunchEnvironment(agent, this.requireStore().getSettings()),
          hostSettings: () => this.requireStore().getSettings()
        }
      )
  }

  /** Resolve catalog account home through the same host create-intent resolver when no session record exists. */
  async resolveStructuredAgentAccountHome(
    agent: StructuredAgentId
  ): Promise<AgentSessionAccountHome> {
    const resolveAccountHome = this.structuredAgentAccountHomeResolver(agent, '', 'read')
    if (!resolveAccountHome) {
      throw agentSessionRefusalError('structured_agent_session_unsupported', {
        reason: 'hostUnsupported'
      })
    }
    // A read, not a launch: only the account push is awaited, never a folder refresh.
    await this.accounts.prepareHostAgentLaunch(null)
    const launchEnv = this.structuredAgentLaunchEnv(agent, this.requireStore().getSettings())
    return resolveAccountHome({ launchEnv, location: null })
  }

  protected async resolveExplicitClaudeAccountHome(
    agent: string,
    accountId?: string
  ): Promise<AgentSessionAccountHome | null> {
    if (!accountId) {
      return null
    }
    if (agent !== 'claude') {
      throw new Error('An explicit Claude account requires Claude.')
    }
    const prepared = await this.accounts.prepareClaudeAccountLaunch(accountId)
    return { variable: 'CLAUDE_CONFIG_DIR', path: prepared.configDir }
  }

  /** The account home a start of this chat would launch under now, read without side effects; null
   *  for an agent whose chats keep the account they were created on. `identity` names it before its
   *  folder exists; the default read checks availability. */
  async resolveStructuredAgentLaunchAccountHome(
    record: AgentSessionRecord,
    purpose: 'read' | 'identity' = 'read'
  ): Promise<AgentSessionAccountHome | null> {
    if (record.claudeAccountId) {
      if (record.provider !== 'claude') {
        throw new Error('An explicit Claude account requires Claude.')
      }
      const prepared = await this.accounts.prepareClaudeAccountLaunch(record.claudeAccountId)
      return { variable: 'CLAUDE_CONFIG_DIR', path: prepared.configDir }
    }
    const { provider, location } = record
    if (!structuredAgentRuntimeMetadata(provider)?.launchFollowsSelection?.()) {
      return null
    }
    const read = this.structuredAgentAccountHomeResolver(provider, '', purpose)
    const launchEnv = this.structuredAgentLaunchEnv(provider, this.requireStore().getSettings())
    return (await read?.({ launchEnv, location })) ?? null
  }

  /** The same account, prepared for a start in `launchDirectory` as a create prepares it. */
  async prepareStructuredAgentLaunchAccountHome(
    record: AgentSessionRecord,
    launchDirectory: string
  ): Promise<AgentSessionAccountHome | null> {
    if (record.claudeAccountId) {
      if (record.provider !== 'claude') {
        throw new Error('An explicit Claude account requires Claude.')
      }
      const prepared = await this.accounts.prepareClaudeAccountLaunch(record.claudeAccountId)
      return { variable: 'CLAUDE_CONFIG_DIR', path: prepared.configDir }
    }
    const { provider, location } = record
    if (!structuredAgentRuntimeMetadata(provider)?.launchFollowsSelection?.()) {
      return null
    }
    const prepare = this.structuredAgentAccountHomeResolver(provider, '', 'launch', launchDirectory)
    await this.accounts.prepareHostAgentLaunch(provider)
    const launchEnv = this.structuredAgentLaunchEnv(provider, this.requireStore().getSettings())
    return (await prepare?.({ launchEnv, location })) ?? null
  }
}
