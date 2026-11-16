import type { ClaudeAccountLaunchTarget } from '../../../../../shared/agent-accounts/claude/claude-account-launch-target'
import type { AgentDetectionHost } from '../../../../preflight/workspace-agent-detection'
import type { OrcaRuntimeService } from '../../../orca-runtime'

/** Where a managed Claude account would launch for this host; null when unknown or SSH. */
export function claudeLaunchTargetForDetectionHost(
  host: AgentDetectionHost
): ClaudeAccountLaunchTarget | null {
  if (host.kind !== 'local') {
    return null
  }
  const projectRuntime = host.context?.projectRuntime
  if (projectRuntime?.status === 'resolved') {
    return projectRuntime.runtime.kind === 'wsl'
      ? { runtime: 'wsl', wslDistro: projectRuntime.runtime.distro }
      : { runtime: 'host', wslDistro: null }
  }
  if (!projectRuntime && !host.context?.wslDefault) {
    return host.context?.wslDistro
      ? { runtime: 'wsl', wslDistro: host.context.wslDistro }
      : { runtime: 'host', wslDistro: null }
  }
  return null
}

export async function getWorkspaceAccountsSnapshot(
  runtime: Pick<OrcaRuntimeService, 'resolveAgentDetectionHost' | 'getAccountsSnapshot'>,
  worktreeId: string | undefined
) {
  const snapshot = runtime.getAccountsSnapshot()
  if (!worktreeId) {
    return snapshot
  }
  const host = await runtime.resolveAgentDetectionHost(worktreeId)
  return { ...snapshot, claudeLaunchTarget: claudeLaunchTargetForDetectionHost(host) }
}
