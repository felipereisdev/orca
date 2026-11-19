import { expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'
import { RuntimeClientSettingsController } from './runtime-client-settings'

vi.mock('../../../claude/agent-view/agent-view-service', () => ({
  getClaudeAgentViewService: () => ({ reconcile: async () => {} })
}))

function clientSettings(experimentalEphemeralVms?: boolean) {
  const stored = { ...getDefaultSettings('/home/user'), experimentalEphemeralVms }
  return new RuntimeClientSettingsController({
    getSettings: () => stored,
    updateSettings: () => {},
    runDurableMutation: vi.fn()
  }).get()
}

// Phones gate inline video on it: a transcript can outlive the workspace that recorded it.
it("tells paired clients whether the desktop's environments experiment is on", () => {
  expect(clientSettings(true).experimentalEphemeralVms).toBe(true)
  expect(clientSettings(false).experimentalEphemeralVms).toBe(false)
  expect(clientSettings(undefined).experimentalEphemeralVms).toBe(false)
})
