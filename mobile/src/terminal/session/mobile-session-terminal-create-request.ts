import type { MobileQuickCommandLaunch } from '../quick-commands'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { MobileNewTabAgentOption } from '../../session/agent-launch/mobile-new-tab-agent-options'
import { sessionTabCreateTerminal } from '../../session/tabs/mobile-session-tab-write-operations'
import { CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../src/shared/agent-session/agent-session-create-capabilities'

export type MobileSessionTerminalCreateOptions = MobileQuickCommandLaunch['options'] & {
  onPromptSent?: () => void
  errorToast?: string
  sourceChatFork?: { sessionId: string; agent: string }
  /** Show the tab as a terminal even when the agent it runs would open as a chat. */
  terminalView?: boolean
}

export function requestMobileSessionTerminalCreate(args: {
  client: RpcClient
  hostCapabilities?: readonly string[] | null
  worktreeId: string
  afterTabId?: string
  clientMutationId: string
  agent?: MobileNewTabAgentOption['agent']
  options?: MobileQuickCommandLaunch['options']
  sourceChatFork?: { sessionId: string }
}) {
  const { client, worktreeId, afterTabId, clientMutationId, agent, options, sourceChatFork } = args
  if (
    options?.claudeAccountId !== undefined &&
    !args.hostCapabilities?.includes(CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY)
  ) {
    throw new Error('Update Orca on this host to choose a Claude account for this session.')
  }
  const params = {
    worktree: `id:${worktreeId}`,
    afterTabId,
    clientMutationId,
    ...(options?.startupCommand ? { command: options.startupCommand } : {}),
    ...(options?.startupCommandDelivery
      ? { startupCommandDelivery: options.startupCommandDelivery }
      : {}),
    ...(options?.agentPrompt ? { agentPrompt: options.agentPrompt } : {}),
    ...(agent ? { agent } : {}),
    ...(options?.claudeAccountId !== undefined ? { claudeAccountId: options.claudeAccountId } : {}),
    ...(sourceChatFork ? { sourceChatFork } : {}),
    activate: false,
    select: true,
    navigation: 'caller' as const
  }
  return sourceChatFork
    ? sessionTabCreateTerminal.request(client, params, { timeoutMs: 120_000 })
    : sessionTabCreateTerminal.request(client, params)
}
