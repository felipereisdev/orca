import { agentSessionRecordFixture } from '../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { createClaudeStructuredLaunchResolver } from '../runtime/agent-session/launch/structured-agent-launch-composition.test-support'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  installClaudeProfileRouter,
  preparePinnedClaudeTerminalEnv,
  withClaudeProfileTerminalEnv
} from './claude-profile-installed-router'
import { ClaudeProfileRouter, type ClaudeProfileRouterSettings } from './claude-profile-router'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'claude-explicit-account-'))
  roots.push(root)
  const settings: ClaudeProfileRouterSettings = {
    claudeManagedAccounts: ['personal', 'work'].map((id) => ({
      id,
      email: `${id}@example.test`,
      managedAuthPath: '',
      authMethod: 'subscription-oauth',
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    })),
    activeClaudeManagedAccountId: 'personal',
    agentStatusHooksEnabled: false,
    disabledTuiAgents: []
  }
  for (const id of ['personal', 'work']) {
    const home = join(root, 'claude-profiles', id, 'home')
    mkdirSync(home, { recursive: true })
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: `${id}@example.test` } })
    )
    writeFileSync(join(home, '..', 'profile.json'), '{}')
  }
  const router = new ClaudeProfileRouter({
    dataRoot: root,
    userHome: join(root, 'user'),
    env: {},
    getSettings: () => settings,
    runSetup: async () => ({ outcome: 'prepared', warnings: [], surfaces: {} })
  })
  return { root, router, settings }
}

it('prepares simultaneous explicit accounts independently of the selected account', async () => {
  const { root, router, settings } = fixture()
  const work = router.prepareAccountLaunch('work')
  settings.activeClaudeManagedAccountId = 'work'
  const personal = router.prepareAccountLaunch('personal')
  const [w, p] = await Promise.all([work, personal])
  expect(w.configDir).toBe(join(root, 'claude-profiles', 'work', 'home'))
  expect(p.configDir).toBe(join(root, 'claude-profiles', 'personal', 'home'))
  expect(w.envPatch.ORCA_CLAUDE_PROFILE_POINTER).toBeUndefined()
  expect(p.envPatch.ORCA_CLAUDE_PROFILE_POINTER).toBeUndefined()
  expect(settings.activeClaudeManagedAccountId).toBe('work')
})

it('refuses a saved account without its own matching login', async () => {
  const { root, router } = fixture()
  writeFileSync(
    join(root, 'claude-profiles', 'work', 'home', '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'personal@example.test' } })
  )
  await expect(router.prepareAccountLaunch('work')).rejects.toMatchObject({ reason: 'notSignedIn' })
})

it('refuses a removed explicit account rather than selecting the default', async () => {
  const { router, settings } = fixture()
  settings.claudeManagedAccounts = settings.claudeManagedAccounts.filter(({ id }) => id !== 'work')
  await expect(router.prepareAccountLaunch('work')).rejects.toMatchObject({
    reason: 'claudeAccountFolderMissing'
  })
})

it('keeps the terminal account when inherited defaults and shell pointers name another account', async () => {
  const { root, router } = fixture()
  installClaudeProfileRouter(router)
  try {
    const inherited = {
      ORCA_CLAUDE_ACCOUNT_ID: 'work',
      ORCA_CLAUDE_PROFILE_POINTER: router.pointerPath,
      CLAUDE_CONFIG_DIR: '/other-account',
      ANTHROPIC_API_KEY: 'another-login'
    }
    const env = await preparePinnedClaudeTerminalEnv(inherited, { runtime: 'host' })
    const launch = withClaudeProfileTerminalEnv(env, { runtime: 'host' })
    expect(launch?.CLAUDE_CONFIG_DIR).toBe(join(root, 'claude-profiles', 'work', 'home'))
    expect(launch?.ORCA_CLAUDE_PROFILE_POINTER).toBeUndefined()
    expect(launch?.ANTHROPIC_API_KEY).toBeUndefined()
  } finally {
    installClaudeProfileRouter(undefined)
  }
})

it('reacquires a chat using its persisted explicit account instead of the global selection', async () => {
  const { root, router } = fixture()
  installClaudeProfileRouter(router)
  try {
    const record = {
      ...agentSessionRecordFixture(),
      claudeAccountId: 'work',
      providerHandleChain: [],
      accountHome: {
        variable: 'CLAUDE_CONFIG_DIR',
        path: join(root, 'claude-profiles', 'work', 'home')
      }
    }
    const launch = createClaudeStructuredLaunchResolver({
      store: { getRecord: () => record, pinLaunchDirectory: async () => record },
      resolveWorkspacePath: async () => root,
      resolveLaunchArgs: () => [],
      resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      resolveInheritedEnv: async () => ({ PATH: '/usr/bin' }),
      resolveAuthPolicy: () => ({ account: 'system' })
    })
    const output = await launch({
      identity: {
        sessionId: record.sessionId,
        workspaceId: record.location.workspaceId,
        hostId: 'local',
        agent: 'claude',
        providerHandle: null
      }
    })
    expect(output.env.CLAUDE_CONFIG_DIR).toBe(join(root, 'claude-profiles', 'work', 'home'))
    expect(output.accountRecipe).toMatchObject({ route: 'managed', accountId: 'work' })
  } finally {
    installClaudeProfileRouter(undefined)
  }
})
