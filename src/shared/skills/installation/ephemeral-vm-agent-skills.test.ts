import { describe, expect, it } from 'vitest'
import { ephemeralVmAgentSkillNames } from './ephemeral-vm-agent-skills'

describe('ephemeralVmAgentSkillNames', () => {
  it('offers the desktop skill with the recipe skill while the experiment is on', () => {
    expect(ephemeralVmAgentSkillNames({ experimentalEphemeralVms: true })).toEqual([
      'orca-per-workspace-env',
      'orca-desktop'
    ])
  })

  it('offers nothing while the experiment is off', () => {
    expect(ephemeralVmAgentSkillNames({ experimentalEphemeralVms: false })).toEqual([])
  })
})
