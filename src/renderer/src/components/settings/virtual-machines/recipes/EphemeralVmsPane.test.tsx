// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EphemeralVmsPane } from './EphemeralVmsPane'

vi.mock('../../../skills/setup/AgentSkillSetupPanel', () => ({
  AgentSkillSetupPanel: () => null
}))
vi.mock('@/hooks/skills/discovery/useInstalledAgentSkills', () => ({
  GLOBAL_AGENT_SKILL_SOURCE_KINDS: [],
  useInstalledAgentSkill: () => ({
    installed: true,
    loading: false,
    error: null,
    refresh: () => undefined
  })
}))
vi.mock('@/hooks/skills/runtime/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({
    discoveryTarget: undefined,
    installDisabledReason: undefined,
    canUseSkillFreshness: false
  })
}))

let originalApi: typeof window.api

beforeEach(() => {
  originalApi = window.api
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ephemeralVm: {
        listRecipeCatalog: vi.fn(async () => []),
        listCredentialEnvNames: vi.fn(async () => [])
      }
    }
  })
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
})

describe('EphemeralVmsPane', () => {
  it('lists the Desktop tab among what the skill can set up', async () => {
    const { container } = render(<EphemeralVmsPane />)
    await act(async () => {})

    expect(container.querySelector('[data-what-item="desktop"]')?.textContent?.trim()).toBeTruthy()
  })
})
