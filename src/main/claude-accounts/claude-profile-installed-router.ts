import { explicitClaudeAccountEnv } from './environment'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'
import { claudeProfileMissing } from './claude-profile-launch-errors'
import { join } from 'node:path'
import { isDirectory } from './claude-profile-homes'
// Keep the router setup graph out of scan workers.
import type { ClaudeProfileRouter } from './claude-profile-router'
import type { ClaudeWslProfileRouter } from './claude-profile-wsl-router'
import type { ClaudeAccountSelectionTarget } from './runtime-selection'
import type { ClaudeObservedConfigDirs } from './claude-observed-config-dirs'

let installed: ClaudeProfileRouter | undefined
let explicitHostResolver: ((accountId: string) => Promise<ClaudeRuntimeAuthPreparation>) | undefined

export function installClaudeHostAccountResolver(resolver: typeof explicitHostResolver): void {
  explicitHostResolver = resolver
}

/** Installed only in the desktop process. */
export function installClaudeProfileRouter(router: ClaudeProfileRouter | undefined): void {
  installed = router
}

export function getClaudeProfileRouter(): ClaudeProfileRouter | undefined {
  return installed
}

let installedObserved: ClaudeObservedConfigDirs | undefined

export function installClaudeObservedConfigDirs(dirs: ClaudeObservedConfigDirs | undefined): void {
  installedObserved = dirs
}

export function getClaudeObservedConfigDirs(): ClaudeObservedConfigDirs | undefined {
  return installedObserved
}

let installedWsl: ClaudeWslProfileRouter | undefined

export function installClaudeWslProfileRouter(router: ClaudeWslProfileRouter | undefined): void {
  installedWsl = router
}

export function getClaudeWslProfileRouter(): ClaudeWslProfileRouter | undefined {
  return installedWsl
}

export function prepareExplicitClaudeAccountLaunch(
  accountId: string,
  target?: ClaudeAccountSelectionTarget
): Promise<ClaudeRuntimeAuthPreparation> {
  if (target?.runtime === 'wsl' && target.wslDistro && installedWsl) {
    return installedWsl.prepareAccountLaunch(target.wslDistro, accountId)
  }
  if (!installed && target?.runtime !== 'wsl' && explicitHostResolver) {
    return explicitHostResolver(accountId)
  }
  if (!installed || target?.runtime === 'wsl') {
    throw claudeProfileMissing()
  }
  return installed.prepareAccountLaunch(accountId)
}

export function withClaudeProfileTerminalEnv<Env extends Record<string, string> | undefined>(
  env: Env,
  target: ClaudeAccountSelectionTarget
): Env | Record<string, string> {
  if (env?.ORCA_CLAUDE_ACCOUNT_ID) {
    return env
  }
  const profileEnv = installed?.terminalEnv(target)
  return profileEnv ? { ...env, ...profileEnv } : env
}

/** The user's CLAUDE_CONFIG_DIR from the login shell, folders Orca saw Claude use, and account homes. */
export function claudeProfileHistoryDirs(surface: 'projects' | 'transcripts'): string[] {
  const homes = [
    installed?.userConfigDir(),
    ...(installedObserved?.list() ?? []),
    ...(installed?.accountHomes() ?? [])
  ].filter((home): home is string => Boolean(home))
  const dirs = homes.map((home) => join(home, surface)).filter(isDirectory)
  return dirs.filter((dir, index) => dirs.indexOf(dir) === index)
}

export async function preparePinnedClaudeTerminalEnv(
  env: Record<string, string> | undefined,
  target: ClaudeAccountSelectionTarget
): Promise<Record<string, string> | undefined> {
  const accountId = env?.ORCA_CLAUDE_ACCOUNT_ID
  if (!accountId) {
    return env
  }
  const prepared = await prepareExplicitClaudeAccountLaunch(accountId, target)
  return explicitClaudeAccountEnv(env, accountId, prepared.envPatch)
}

export async function prepareClaudeTerminalLaunch(
  env: Record<string, string> | undefined,
  target: ClaudeAccountSelectionTarget,
  prepareDefault?: (target: ClaudeAccountSelectionTarget) => Promise<ClaudeRuntimeAuthPreparation>
) {
  const accountId = env?.ORCA_CLAUDE_ACCOUNT_ID
  const claudeAuth = accountId
    ? await prepareExplicitClaudeAccountLaunch(accountId, target)
    : ((await prepareDefault?.(target)) ?? null)
  return {
    env:
      accountId && claudeAuth
        ? explicitClaudeAccountEnv(env ?? {}, accountId, claudeAuth.envPatch)
        : withClaudeProfileTerminalEnv(env, target),
    claudeAuth
  }
}
