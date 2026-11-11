import type { AppState } from '@/store/types'

export function claudePaneAccountId(
  state: Pick<AppState, 'agentLaunchConfigByPaneKey' | 'sleepingAgentSessionsByPaneKey'>,
  paneKey: string
): string | undefined {
  const recipe =
    state.agentLaunchConfigByPaneKey[paneKey]?.launchConfig ??
    state.sleepingAgentSessionsByPaneKey[paneKey]?.launchConfig
  return recipe?.agentEnv.ORCA_CLAUDE_ACCOUNT_ID
}
