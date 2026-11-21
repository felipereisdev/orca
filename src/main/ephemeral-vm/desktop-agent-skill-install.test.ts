import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { environmentId: string; method: string; params: unknown }[] = []
let executeReply: () => unknown

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: vi.fn(
    async (_root: string, environmentId: string, method: string, params: unknown) => {
      calls.push({ environmentId, method, params })
      if (method === 'skills.planBundledOrca') {
        return { id: 'r', ok: true, result: { planDigest: 'a'.repeat(64), skills: [] } }
      }
      return executeReply()
    }
  )
}))

import {
  installDesktopAgentSkillOnEnvironment,
  resetDesktopAgentSkillInstalls
} from './desktop-agent-skill-install'

const RAN = {
  id: 'r',
  ok: true,
  result: {
    scope: 'global',
    skills: [{ name: 'orca-desktop', status: 'ran', ops: [{ path: '/p', status: 'done' }] }]
  }
}

describe('installDesktopAgentSkillOnEnvironment', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    executeReply = () => RAN
  })
  afterEach(() => {
    warn.mockRestore()
    calls.splice(0)
    resetDesktopAgentSkillInstalls()
  })

  it("installs orca-desktop on the environment's own host from the plan it returned", async () => {
    expect(await installDesktopAgentSkillOnEnvironment('env-1')).toBe('installed')
    expect(calls).toEqual([
      {
        environmentId: 'env-1',
        method: 'skills.planBundledOrca',
        params: { names: ['orca-desktop'] }
      },
      {
        environmentId: 'env-1',
        method: 'skills.executeBundledOrca',
        params: { planDigest: 'a'.repeat(64), request: { names: ['orca-desktop'] } }
      }
    ])
    expect(await installDesktopAgentSkillOnEnvironment('env-1')).toBe('already-installed')
    expect(calls).toHaveLength(2)
  })

  it('tries again on the next hand-over after a failed install', async () => {
    executeReply = () => ({ id: 'r', ok: false, error: { code: 'forbidden', message: 'no' } })
    expect(await installDesktopAgentSkillOnEnvironment('env-1')).toBe('failed')
    executeReply = () => RAN
    expect(await installDesktopAgentSkillOnEnvironment('env-1')).toBe('installed')
  })
})
