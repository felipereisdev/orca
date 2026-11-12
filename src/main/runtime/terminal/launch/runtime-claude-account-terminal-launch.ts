import { explicitClaudeAccountEnv } from '../../../claude-accounts/runtime-auth/environment'
import type { TerminalWorkspaceLaunchScope } from '../../orchestration/terminal-authority/structured-sessions/runtime-legacy-worker-terminal-recovery-types'
import type { RuntimeAccountController } from '../../agent-session/environment/runtime-account-controller'
import type { TerminalCreateOptions } from './terminal-create-options'
import { resolveWslSessionContext } from '../../../daemon/pty-subprocess/wsl-session-context'

export async function prepareClaudeAccountTerminalLaunch(
  workspace: TerminalWorkspaceLaunchScope,
  opts: TerminalCreateOptions,
  launch: TerminalCreateOptions,
  accounts: Pick<RuntimeAccountController, 'prepareClaudeAccountLaunch'>
): Promise<TerminalCreateOptions | null> {
  const accountId =
    opts.claudeAccountId ??
    launch.env?.ORCA_CLAUDE_ACCOUNT_ID ??
    launch.launchConfig?.agentEnv.ORCA_CLAUDE_ACCOUNT_ID
  if (accountId) {
    if ((launch.launchAgent ?? opts.startupAgent) !== 'claude' || workspace.connectionId) {
      throw new Error('The requested Claude account is not available on this execution host.')
    }
    const wsl = resolveWslSessionContext({
      cwd: launch.cwd ?? workspace.path,
      ...launch.launchRuntime?.pty,
      shellOverride: launch.shellOverride ?? launch.launchRuntime?.pty.shellOverride
    })
    const prepared = await accounts.prepareClaudeAccountLaunch(
      accountId,
      wsl ? { runtime: 'wsl', wslDistro: wsl.distro } : { runtime: 'host' }
    )
    const env = explicitClaudeAccountEnv(launch.env ?? {}, accountId, prepared.envPatch)
    return {
      ...launch,
      claudeAccountId: accountId,
      env,
      ...(launch.launchConfig
        ? {
            launchConfig: {
              ...launch.launchConfig,
              agentEnv: explicitClaudeAccountEnv(
                launch.launchConfig.agentEnv,
                accountId,
                prepared.envPatch
              )
            }
          }
        : {})
    }
  }
  return null
}
