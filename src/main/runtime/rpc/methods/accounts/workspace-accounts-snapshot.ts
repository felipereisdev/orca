import type { ClaudeAccountLaunchTarget } from '../../../../../shared/claude-account-launch-target'
import type { OrcaRuntimeService } from '../../../orca-runtime'

export async function getWorkspaceAccountsSnapshot(
  runtime: Pick<OrcaRuntimeService, 'resolveAgentDetectionHost' | 'getAccountsSnapshot'>,
  worktreeId: string | undefined
) {
  const snapshot = runtime.getAccountsSnapshot()
  if (!worktreeId) {
    return snapshot
  }
  const host = await runtime.resolveAgentDetectionHost(worktreeId)
  let claudeLaunchTarget: ClaudeAccountLaunchTarget | null = null
  if (host.kind === 'local') {
    const projectRuntime = host.context?.projectRuntime
    if (projectRuntime?.status === 'resolved') {
      claudeLaunchTarget =
        projectRuntime.runtime.kind === 'wsl'
          ? { runtime: 'wsl', wslDistro: projectRuntime.runtime.distro }
          : { runtime: 'host', wslDistro: null }
    } else if (!projectRuntime && !host.context?.wslDefault) {
      claudeLaunchTarget = host.context?.wslDistro
        ? { runtime: 'wsl', wslDistro: host.context.wslDistro }
        : { runtime: 'host', wslDistro: null }
    }
  }
  return { ...snapshot, claudeLaunchTarget }
}
