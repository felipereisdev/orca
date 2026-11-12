import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostAccountLaunchEnv } from '../../../../shared/agent-launch/startup/host-account-launch-env'
import type { HostClaudeProfileRefresh } from './host-claude-profile-refresh'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth/runtime-auth-types'
import { claudeProfileMissing } from '../../../claude-accounts/profiles/routing/claude-profile-launch-errors'
import { claudeProfileMarkerPath } from '../../../claude-accounts/profiles/claude-profile-paths'
import {
  readClaudeFolderLoginAsync,
  isSameClaudeLogin
} from '../../../claude-accounts/sign-in/claude-account-folder'
import { wslClaudeProfile } from '../../../claude-accounts/profiles/wsl/claude-profile-wsl-paths'
import { AgentSessionPreSpawnError } from '../../../native-chat/agent-session-wire/providers/structured-agent-session-adapter-errors'

export async function prepareHostClaudeAccountLaunch(
  accountId: string,
  launchEnv: HostAccountLaunchEnv | null,
  refresh: HostClaudeProfileRefresh | null
): Promise<ClaudeRuntimeAuthPreparation> {
  const account = launchEnv?.claudeAccounts?.[accountId]
  if (!account || !launchEnv) {
    throw claudeProfileMissing()
  }
  const { profile } = wslClaudeProfile(homedir(), launchEnv.wslDistro, accountId)
  if (
    profile.home !== account.configDir ||
    !(await stat(claudeProfileMarkerPath(profile)).then(
      (entry) => entry.isFile(),
      () => false
    ))
  ) {
    throw claudeProfileMissing()
  }
  const login = await readClaudeFolderLoginAsync(join(profile.home, '.claude.json'))
  if (account.needsSignIn || !login || !isSameClaudeLogin(account, login)) {
    throw new AgentSessionPreSpawnError(
      new Error('Sign in to this Claude account again before launching it.'),
      { reason: 'notSignedIn' }
    )
  }
  const envPatch = { CLAUDE_CONFIG_DIR: profile.home }
  await refresh?.({ ...launchEnv, claude: envPatch })
  return { configDir: profile.home, envPatch, provenance: `profile:${accountId}`, runtime: 'host' }
}
