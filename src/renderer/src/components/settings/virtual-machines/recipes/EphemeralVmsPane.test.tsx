// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
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
  it('tells the user a recipe can include a Desktop tab', async () => {
    render(<EphemeralVmsPane />)
    await act(async () => {})

    expect(
      screen.getByText(
        'Can add a Desktop tab: watch the agent live, take over control, and record tests that play in the chat.'
      )
    ).toBeTruthy()
  })
})
