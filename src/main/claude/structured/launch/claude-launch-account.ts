import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth/runtime-auth-types'
import type { ClaudeAccountRecipe } from '../../../../shared/agent-session/lifecycle/agent-session-acquired-account'
import type { ClaudeProfileRouter } from '../../../claude-accounts/profiles/routing/claude-profile-router'
import {
  explicitClaudeAccountEnv,
  applyClaudeEnvPatch
} from '../../../claude-accounts/runtime-auth/environment'
import { resolveStructuredClaudeAccountHomePath } from '../../../runtime/agent-session/environment/structured-agent-account-home'

/** The account a launch runs under is the current selection; the receipt records what it used. */
export async function prepareClaudeLaunchAccount(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  recordHome: string,
  claudeAccountId?: string,
  prepareExplicit?: (accountId: string) => Promise<ClaudeRuntimeAuthPreparation>
): Promise<ClaudeAccountRecipe> {
  if (claudeAccountId) {
    const preparation = prepareExplicit
      ? await prepareExplicit(claudeAccountId)
      : await router?.prepareAccountLaunch(claudeAccountId)
    if (!preparation) {
      throw new Error('The selected Claude account is unavailable on this host.')
    }
    const pinned = explicitClaudeAccountEnv(env, claudeAccountId, preparation.envPatch)
    for (const key of Object.keys(env)) {
      delete env[key]
    }
    Object.assign(env, pinned)
    return { route: 'managed', accountId: claudeAccountId, home: preparation.configDir }
  }
  if (!router) {
    return { route: 'system', home: recordHome, configDir: env.CLAUDE_CONFIG_DIR ?? null }
  }
  const preparation = await router.prepareLaunch()
  const home =
    preparation.provenance === 'system'
      ? await resolveStructuredClaudeAccountHomePath({
          launchEnv: env,
          wslDistro: null,
          getClaudeConfigDirectory: () => router.systemDefaultHome()
        })
      : preparation.configDir
  applyClaudeEnvPatch(env, preparation.envPatch)
  return preparation.provenance.startsWith('profile:')
    ? { route: 'managed', accountId: preparation.provenance.slice('profile:'.length), home }
    : { route: 'system', home, configDir: env.CLAUDE_CONFIG_DIR ?? null }
}
