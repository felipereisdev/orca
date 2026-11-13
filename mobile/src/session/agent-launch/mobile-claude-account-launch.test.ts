import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { RpcResponse } from '../../transport/rpc/rpc-wire-types'
import {
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITY
} from '../../../../src/shared/agent-launch/contracts/agent-launch-runtime-capability'
import { CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../src/shared/agent-session/agent-session-create-capabilities'
import { launchNewTabAgentThroughHost } from './new-tab-agent-host-launch'
import { requestMobileSessionTerminalCreate } from '../../terminal/session/mobile-session-terminal-create-request'

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))

function accountLaunchHost() {
  const requests: { method: string; params: unknown }[] = []
  const client: RpcClient = {
    sendRequest: async (method, params): Promise<RpcResponse> => {
      requests.push({ method, params })
      return {
        id: 'launch-reply',
        ok: true,
        result: {
          worktreeId: 'folder:account-workspace',
          outcome: { kind: 'terminal', handle: 'terminal:account-launch' },
          receipt: {
            mode: 'terminal',
            preferred: 'terminal',
            reason: 'user_default',
            detail: 'Terminal selected'
          }
        }
      }
    },
    subscribe: () => () => {},
    updateTerminalSubscriptionViewport: () => {},
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  }
  return { client, requests }
}

function launchNewTab(client: RpcClient, hostCapabilities: readonly string[]) {
  const failures: string[] = []
  const launch = launchNewTabAgentThroughHost({
    client,
    hostCapabilities,
    worktreeId: 'folder:account-workspace',
    agent: 'claude',
    options: { claudeAccountId: 'claude-work-account' },
    lock: 'account-launch',
    pendingSelectionRef: { current: null },
    fetchSessionTabs: async () => {},
    getSessionTabs: () => [],
    showToast: () => {},
    reportCreateFailure: (message) => failures.push(message),
    setCreateError: (message) => failures.push(message)
  })
  return { launch, failures }
}

describe('mobile named Claude account launch', () => {
  it('carries the selected account from New Tab to the host launch RPC', async () => {
    const { client, requests } = accountLaunchHost()
    const { launch } = launchNewTab(client, [
      AGENT_LAUNCH_RUNTIME_CAPABILITY,
      AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
      'agent-launch.claude-account.v1'
    ])

    await expect(launch).resolves.toBe(true)
    expect(requests).toEqual([
      {
        method: 'agent.launchReplay',
        params: expect.objectContaining({
          agent: 'claude',
          claudeAccountId: 'claude-work-account',
          target: { kind: 'existing', worktree: 'id:folder:account-workspace' }
        })
      }
    ])
  })

  it('handles an unsupported account launch without starting the host default', async () => {
    const { client, requests } = accountLaunchHost()
    const { launch, failures } = launchNewTab(client, [
      AGENT_LAUNCH_RUNTIME_CAPABILITY,
      AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
      CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY
    ])

    await expect(launch).resolves.toBe(true)
    expect({ refused: failures.length > 0, requests }).toEqual({ refused: true, requests: [] })
  })

  it('preserves the selected account in the terminal compatibility RPC', async () => {
    const { client, requests } = accountLaunchHost()
    await requestMobileSessionTerminalCreate({
      client,
      hostCapabilities: [CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY],
      worktreeId: 'folder:account-workspace',
      clientMutationId: 'account-terminal-create',
      agent: 'claude',
      options: { claudeAccountId: 'claude-work-account' }
    })

    expect(requests).toEqual([
      {
        method: 'session.tabs.createTerminal',
        params: expect.objectContaining({
          agent: 'claude',
          claudeAccountId: 'claude-work-account',
          worktree: 'id:folder:account-workspace'
        })
      }
    ])
  })
})
