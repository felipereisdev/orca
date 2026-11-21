import { describe, expect, it } from 'vitest'
import {
  localOrcadDockerPlatform,
  localOrcadTemplateTargets,
  packagingOrcadTemplateTargets
} from './local-orcad-template-targets.cjs'

const ALL_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-glibc',
  'linux-x64-glibc',
  'linux-arm64-musl',
  'linux-x64-musl',
  'win32-arm64',
  'win32-x64'
]

describe('localOrcadTemplateTargets', () => {
  it('defaults to linux-arm64-glibc', () => {
    expect(localOrcadTemplateTargets({})).toEqual(['linux-arm64-glibc'])
    expect(localOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: ' ' })).toEqual([
      'linux-arm64-glibc'
    ])
  })

  it('reads a deduplicated comma-separated list', () => {
    expect(
      localOrcadTemplateTargets({
        ORCA_LOCAL_ORCAD_TARGETS: 'linux-x64-glibc, linux-arm64-glibc,linux-x64-glibc'
      })
    ).toEqual(['linux-x64-glibc', 'linux-arm64-glibc'])
  })

  it('turns the step off with none', () => {
    expect(localOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: 'none' })).toBeNull()
  })

  it('refuses a target outside the template matrix', () => {
    expect(() => localOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: 'linux-riscv64' })).toThrow(
      'linux-riscv64'
    )
    expect(() => localOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: ',' })).toThrow()
  })
})

describe('localOrcadDockerPlatform', () => {
  it('maps glibc Linux targets to a Docker platform', () => {
    expect(localOrcadDockerPlatform('linux-arm64-glibc')).toBe('linux/arm64')
    expect(localOrcadDockerPlatform('linux-x64-glibc')).toBe('linux/amd64')
  })

  it('refuses targets a Linux glibc container cannot build', () => {
    for (const target of ['linux-arm64-musl', 'darwin-arm64', 'win32-x64']) {
      expect(() => localOrcadDockerPlatform(target)).toThrow(target)
    }
  })
})

describe('packagingOrcadTemplateTargets', () => {
  it('checks every target when nothing is declared', () => {
    expect(packagingOrcadTemplateTargets({})).toEqual(ALL_TARGETS)
    expect(packagingOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: 'none' })).toEqual(ALL_TARGETS)
  })

  it('checks exactly the declared targets of a local build', () => {
    expect(
      packagingOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: 'linux-arm64-glibc' })
    ).toEqual(['linux-arm64-glibc'])
  })

  it('ignores a declaration when the release requires the full template', () => {
    expect(
      packagingOrcadTemplateTargets({
        ORCA_LOCAL_ORCAD_TARGETS: 'linux-arm64-glibc',
        ORCA_REQUIRE_ORCAD_TEMPLATE: '1'
      })
    ).toEqual(ALL_TARGETS)
  })
})
