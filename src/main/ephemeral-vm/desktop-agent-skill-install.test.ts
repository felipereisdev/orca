import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SHARED = '/home/dev/.agents/skills/orca-desktop'
const CLAUDE = '/home/dev/.claude/skills/orca-desktop'
const DIGEST = 'a'.repeat(64)

const calls: { environmentId: string; method: string; params: unknown }[] = []
let executeReply: () => unknown
let afterPlan: () => void

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: vi.fn(
    async (_root: string, environmentId: string, method: string, params: unknown) => {
      calls.push({ environmentId, method, params })
      if (method === 'skills.planBundledOrca') {
        afterPlan()
        return {
          id: 'r',
          ok: true,
          result: {
            planDigest: DIGEST,
            skills: [
              {
                name: 'orca-desktop',
                ops: [
                  { path: SHARED, kind: 'write' },
                  { path: CLAUDE, kind: 'link' }
                ]
              }
            ]
          }
        }
      }
      return executeReply()
    }
  )
}))

import {
  installDesktopAgentSkillOnEnvironment,
  resetDesktopAgentSkillInstalls
} from './desktop-agent-skill-install'

function executed(skills: unknown[]): unknown {
  return { id: 'r', ok: true, result: { scope: 'global', skills } }
}

const RAN = executed([
  {
    name: 'orca-desktop',
    status: 'ran',
    ops: [
      { path: SHARED, kind: 'write', status: 'done' },
      { path: CLAUDE, kind: 'link', status: 'done' }
    ]
  }
])

const enabled = (): boolean => true

describe('installDesktopAgentSkillOnEnvironment', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    executeReply = () => RAN
    afterPlan = () => {}
  })
  afterEach(() => {
    warn.mockRestore()
    calls.splice(0)
    resetDesktopAgentSkillInstalls()
  })

  it("installs orca-desktop on the environment's own host from the plan it returned", async () => {
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('installed')
    expect(calls).toEqual([
      {
        environmentId: 'env-1',
        method: 'skills.planBundledOrca',
        params: { names: ['orca-desktop'] }
      },
      {
        environmentId: 'env-1',
        method: 'skills.executeBundledOrca',
        params: { planDigest: DIGEST, request: { names: ['orca-desktop'] } }
      }
    ])
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('already-installed')
    expect(calls).toHaveLength(2)
  })

  it('tries again on the next hand-over after a failed install', async () => {
    executeReply = () => ({ id: 'r', ok: false, error: { code: 'forbidden', message: 'no' } })
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('failed')
    executeReply = () => RAN
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('installed')
  })

  it('does not count a destination whose disk changed under the write', async () => {
    executeReply = () =>
      executed([
        {
          name: 'orca-desktop',
          status: 'ran',
          ops: [
            { path: SHARED, kind: 'write', status: 'done' },
            { path: CLAUDE, kind: 'link', status: 'changed' }
          ]
        }
      ])
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('failed')
    executeReply = () => RAN
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('installed')
  })

  it('does not count a destination it left alone because it was unwritable', async () => {
    executeReply = () =>
      executed([
        {
          name: 'orca-desktop',
          status: 'ran',
          ops: [
            { path: SHARED, kind: 'write', status: 'done' },
            { path: CLAUDE, kind: 'leave', status: 'done', reason: 'unwritable' }
          ]
        }
      ])
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('failed')
  })

  it('does not count an answer that installed no skill', async () => {
    executeReply = () => executed([])
    expect(await installDesktopAgentSkillOnEnvironment('env-1', enabled)).toBe('failed')
  })

  it('starts nothing once the experiment is off', async () => {
    expect(await installDesktopAgentSkillOnEnvironment('env-1', () => false)).toBe('skipped')
    expect(calls).toEqual([])
  })

  it('sends no write when the experiment is turned off while planning', async () => {
    let on = true
    afterPlan = () => {
      on = false
    }
    expect(await installDesktopAgentSkillOnEnvironment('env-1', () => on)).toBe('skipped')
    expect(calls.map((call) => call.method)).toEqual(['skills.planBundledOrca'])
  })
})
