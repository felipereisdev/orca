import { describe, expect, it } from 'vitest'
import { claudeStreamJsonExitError } from '../../sdk-transport/claude-stream-json-exit-error'
import {
  CLAUDE_PLUGIN_DIRS_ENV,
  createClaudeCliFlagSupport
} from '../../cli-capabilities/claude-cli-flag-support'
import { explicitClaudeAccountEnv } from '../../../claude-accounts/runtime-auth/environment'
import { withClaudeLaunchAccountPin } from './claude-launch-account'

const SIDELOAD_REFUSAL =
  "Error: CLAUDE_CODE_PLUGIN_DIRS is disabled by your organization's managed settings (disableSideloadFlags)."

function flagSupport() {
  return createClaudeCliFlagSupport({
    probe: async () => '2.1.328',
    keyOf: async (command, cwd) => `${command}\n${cwd}`,
    budgetMs: 1_000,
    now: () => performance.now()
  })
}

describe('withClaudeLaunchAccountPin', () => {
  it("asks as a chat's chosen account, so its own refusal is honored while another account is selected", async () => {
    const support = flagSupport()
    const base = { command: '/bin/claude', cwd: '/repo' }
    // The chat runs on the work account; the selection elsewhere is the personal one.
    const spawnEnv = explicitClaudeAccountEnv({}, 'work', { CLAUDE_CONFIG_DIR: '/accounts/work' })
    support.observeExit(
      { ...base, env: spawnEnv },
      claudeStreamJsonExitError(SIDELOAD_REFUSAL, { code: 1, signal: null, processless: false })
    )
    const selectedRouter = {
      systemDefaultHome: () => '/accounts/personal'
    } as unknown as Parameters<typeof withClaudeLaunchAccountPin>[0]

    const probeEnv = await withClaudeLaunchAccountPin(selectedRouter, {}, '/record', {
      accountId: 'work',
      homeOf: (accountId) => (accountId === 'work' ? '/accounts/work' : null)
    })

    await expect
      .poll(() => support.check(CLAUDE_PLUGIN_DIRS_ENV, { ...base, env: probeEnv }))
      .toBe('unsupported')
  })
})
