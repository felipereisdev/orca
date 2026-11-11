import { afterEach, expect, it, vi } from 'vitest'
import { assemblePtySpawnEnvDeletions } from './spawn-options-assembly'
import { createDaemonPtyEnvironment } from '../../daemon/pty-subprocess/spawn-environment'
import { buildInheritedLocalPtyEnvironment } from '../../providers/local-pty/local-pty-spawn-environment'

afterEach(() => vi.unstubAllEnvs())
it.each(['local', 'daemon'])(
  'does not resurrect inherited auth headers in a pinned %s child',
  (provider) => {
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'Authorization: personal-token')
    const spawn = assemblePtySpawnEnvDeletions({
      env: { ORCA_CLAUDE_ACCOUNT_ID: 'work', CLAUDE_CONFIG_DIR: '/accounts/work' },
      callerEnvToDelete: undefined,
      agentTeamsEnvToDelete: [],
      isDaemonHostSpawn: true,
      connectionId: null,
      skipCodexHomeEnv: false,
      stripInheritedOrcaCodexHome: false,
      codexResumeHomeSelected: false,
      settings: undefined
    })
    const child =
      provider === 'local'
        ? buildInheritedLocalPtyEnvironment(spawn.env, spawn.envToDelete)
        : createDaemonPtyEnvironment({ sessionId: 'pinned-work', cols: 80, rows: 24, ...spawn })
    expect(child.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(child.CLAUDE_CONFIG_DIR).toBe('/accounts/work')
  }
)
