import type { ClaudeProfileRouter } from './profiles/routing/claude-profile-router'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'
import { claudeProfileMissing } from './profiles/routing/claude-profile-launch-errors'
import { isSameClaudeLogin } from './sign-in/claude-account-folder'
import { isDirectory } from './profiles/claude-profile-homes'
import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/providers/structured-agent-session-adapter-errors'

export async function prepareExplicitClaudeProfile(
  router: Pick<ClaudeProfileRouter, 'savedAccount' | 'accountHome' | 'accountLogin'>,
  accountId: string,
  prepare: () => Promise<void>
): Promise<ClaudeRuntimeAuthPreparation> {
  const saved = router.savedAccount(accountId)
  if (!saved || saved.managedAuthRuntime === 'wsl') {
    throw claudeProfileMissing()
  }
  const home = router.accountHome(accountId)
  if (!isDirectory(home)) {
    throw claudeProfileMissing()
  }
  const login = router.accountLogin(accountId)
  if (!login || !isSameClaudeLogin(saved, login)) {
    throw new AgentSessionPreSpawnError(
      new Error('Sign in to this Claude account again before launching it.'),
      { reason: 'notSignedIn' }
    )
  }
  await prepare()
  return {
    configDir: home,
    runtime: 'host',
    wslDistro: null,
    envPatch: { CLAUDE_CONFIG_DIR: home },
    provenance: `profile:${accountId}`
  }
}
