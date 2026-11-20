import { isTuiAgent } from '../../../../../../../../shared/agent-launch/catalog/tui-agent-config'
import {
  isTuiAgentEnabled,
  TUI_AGENT_AUTO_PICK_ORDER
} from '../../../../../../../../shared/agent-launch/catalog/tui-agent-selection'
import type { TuiAgent } from '../../../../../../../../shared/agent-launch/catalog/tui-agent'
import type { OrcaRuntimeService } from '../../../../../../orca-runtime'
import { OrchestrationError } from '../../../../../../orchestration/orchestration-error'
import type { FederationAttachStartInput } from '../../../../../../../../shared/rpc-contract/orchestration/orchestration-federation-start-params'
import {
  assertWorkerLaunchPreferencesCreateTerminal,
  createWorkerLaunchReceipt,
  resolveWorkerLaunchPreferences
} from './worker-launch-preferences'
import type { WorkerStartInput } from '../worker-start-input'

type WorkerStartLaunch = ReturnType<typeof resolveWorkerLaunchPreferences>

const TERMINAL_WITH_AGENT_REFUSAL =
  '--terminal continues the agent already running there, in its current conversation. To start fresh, use --worktree or --agent without --terminal.'

export function validateFederatedWorkerStartPlacement(
  params: WorkerStartInput,
  createsWorktree: boolean
): void {
  if (createsWorktree && !params.repo) {
    throw new OrchestrationError(
      'invalid_argument',
      'Remote new-child and new-top-level require an explicit --repo from remote discovery.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with remote new-worktree creation.'
    )
  }
  if (!createsWorktree && (params.name || params.repo || params.baseBranch || params.setup)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to remote new-child or new-top-level worktrees.'
    )
  }
  if (params.terminal && params.agent) {
    throw new OrchestrationError('invalid_argument', TERMINAL_WITH_AGENT_REFUSAL)
  }
  if (!params.terminal && !params.agent) {
    throw new OrchestrationError(
      'agent_unconfigured',
      'A configured --agent is required when remote worker-start creates a terminal.'
    )
  }
}

export function prepareLocalWorkerStart(args: {
  params: WorkerStartInput
  createsWorktree: boolean
  runtime: OrcaRuntimeService
  openCodeModelLaunchSupported?: boolean
}): { agent: TuiAgent | undefined; launch: WorkerStartLaunch } {
  const { params, createsWorktree, runtime } = args
  assertWorkerLaunchPreferencesCreateTerminal(params)
  if (params.terminal && params.agent) {
    throw new OrchestrationError('invalid_argument', TERMINAL_WITH_AGENT_REFUSAL)
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with new-worktree creation.'
    )
  }
  if (!createsWorktree && (params.name || params.repo || params.baseBranch || params.setup)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to new-child or new-top-level worktrees.'
    )
  }
  const resolved = resolveWorkerStartAgent({
    runtime,
    openCodeModelLaunchSupported: args.openCodeModelLaunchSupported,
    createsWorktree,
    terminal: params.terminal,
    agent: params.agent,
    model: params.model,
    effort: params.effort,
    missingAgentMessage: 'A configured --agent is required when worker-start creates a terminal.'
  })
  assertWorkerClaudeAccountAgent(params, resolved.agent)
  return resolved
}

function assertWorkerClaudeAccountAgent(
  params: Pick<WorkerStartInput, 'claudeAccountId' | 'terminal'>,
  agent: TuiAgent | undefined
): void {
  if (!params.claudeAccountId) {
    return
  }
  if (params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--account cannot be applied when reusing an existing terminal.'
    )
  }
  if (agent !== 'claude') {
    throw new OrchestrationError(
      'invalid_argument',
      '--account selects a managed Claude account, so it requires --agent claude.'
    )
  }
}

/** Account ids name this host's vault, so a start placed on another machine cannot use one. */
export function refuseRemoteWorkerClaudeAccount(
  params: Pick<WorkerStartInput, 'claudeAccountId' | 'on'>,
  peerCaller: boolean
): void {
  if (params.claudeAccountId && (params.on || peerCaller)) {
    throw new OrchestrationError(
      'account_unsupported_remote',
      '--account cannot be used for a worker on a connected Orca server. No effects were applied.',
      { effectsApplied: false }
    )
  }
}

/** Refuses before anything is created: an SSH destination, then an account missing or signed out here. */
export async function assertWorkerClaudeAccountUsable(args: {
  runtime: OrcaRuntimeService
  claudeAccountId: string | undefined
  /** The existing workspace the worker joins; otherwise the repo its new worktree is created in. */
  worktreeId: string | undefined
  repoSelector: string | undefined
}): Promise<void> {
  const { runtime, claudeAccountId } = args
  if (!claudeAccountId) {
    return
  }
  const connectionId = args.worktreeId
    ? (await runtime.showTerminalWorkspaceLaunchScope(`id:${args.worktreeId}`)).connectionId
    : args.repoSelector
      ? (await runtime.showRepo(args.repoSelector)).connectionId
      : undefined
  if (connectionId) {
    throw new OrchestrationError(
      'account_unsupported_remote',
      '--account cannot be used for a worker in an SSH workspace. No effects were applied.',
      { effectsApplied: false }
    )
  }
  const account = runtime
    .getClaudeAccountsSnapshot()
    .accounts.find((candidate) => candidate.id === claudeAccountId)
  if (!account) {
    throw new OrchestrationError(
      'invalid_argument',
      `No managed Claude account ${claudeAccountId} on this host. Run \`orca account list\` to see the saved accounts.`
    )
  }
  if (account.needsSignIn) {
    throw new OrchestrationError(
      'invalid_argument',
      `Claude account ${account.email} needs a sign-in before a worker can use it.`
    )
  }
}

export function prepareFederationAttachmentWorkerStart(args: {
  params: FederationAttachStartInput
  createsWorktree: boolean
  runtime: OrcaRuntimeService
  openCodeModelLaunchSupported?: boolean
}): { agent: TuiAgent | undefined; launch: WorkerStartLaunch } {
  const { params, createsWorktree, runtime } = args
  assertWorkerLaunchPreferencesCreateTerminal(params)
  if (createsWorktree && !params.repo) {
    throw new OrchestrationError(
      'invalid_argument',
      'A remote new-top-level worktree requires an explicit --repo.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with remote new-worktree creation.'
    )
  }
  if (
    !createsWorktree &&
    (params.name || params.repo || params.baseBranch || params.setup || params.setupSource)
  ) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to remote new-top-level worktrees.'
    )
  }
  if (params.terminal && params.agent) {
    throw new OrchestrationError('invalid_argument', TERMINAL_WITH_AGENT_REFUSAL)
  }
  return resolveWorkerStartAgent({
    runtime,
    openCodeModelLaunchSupported: args.openCodeModelLaunchSupported,
    createsWorktree,
    terminal: params.terminal,
    agent: params.agent,
    model: params.model,
    effort: params.effort,
    missingAgentMessage:
      'A configured --agent is required when federated worker-start creates a terminal.'
  })
}

function resolveWorkerStartAgent(args: {
  runtime: OrcaRuntimeService
  openCodeModelLaunchSupported?: boolean
  createsWorktree: boolean
  terminal?: string
  agent?: string
  model?: string
  effort?: string
  missingAgentMessage: string
}): { agent: TuiAgent | undefined; launch: WorkerStartLaunch } {
  const agent = args.agent
    ? isTuiAgent(args.agent)
      ? args.agent
      : args.runtime.resolveOrchestrationAgentLauncher?.(args.agent)
    : undefined
  if (!args.terminal && !agent) {
    const { disabledTuiAgents } = args.runtime.getClientSettings()
    const agents = TUI_AGENT_AUTO_PICK_ORDER.filter((id) =>
      isTuiAgentEnabled(id, disabledTuiAgents)
    )
    throw new OrchestrationError(
      'agent_unconfigured',
      agents.length
        ? `${args.missingAgentMessage} Pass --agent with one of: ${agents.join(', ')}.`
        : args.missingAgentMessage
    )
  }
  if (agent) {
    args.runtime.validateOrchestrationAgentLauncher(agent)
    return {
      agent,
      launch: resolveWorkerLaunchPreferences({
        agent,
        openCodeModelLaunchSupported: args.openCodeModelLaunchSupported,
        createsWorktree: args.createsWorktree,
        model: args.model,
        effort: args.effort
      })
    }
  }
  return {
    agent: undefined,
    launch: {
      preferences: undefined,
      receipt: createWorkerLaunchReceipt({ agent: null })
    }
  }
}
