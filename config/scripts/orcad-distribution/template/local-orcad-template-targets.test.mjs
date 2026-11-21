import { describe, expect, it } from 'vitest'
import {
  localOrcadDockerPlatform,
  localOrcadTemplateTargets,
  localPackagingOrcadTemplateTargets
} from './local-orcad-template-targets.cjs'

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

describe('localPackagingOrcadTemplateTargets', () => {
  it('declares nothing when the build sets no local targets', () => {
    expect(localPackagingOrcadTemplateTargets({})).toBeNull()
    expect(localPackagingOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: 'none' })).toBeNull()
  })

  it('declares exactly the targets of a local build', () => {
    expect(
      localPackagingOrcadTemplateTargets({ ORCA_LOCAL_ORCAD_TARGETS: 'linux-arm64-glibc' })
    ).toEqual(['linux-arm64-glibc'])
  })

  it('ignores an inherited declaration in any release or CI build', () => {
    for (const release of [
      { ORCA_REQUIRE_ORCAD_TEMPLATE: '1' },
      { ORCA_MAC_RELEASE: '1' },
      { ORCA_MAC_HOURLY: '1' },
      { ORCA_WIN_DAILY: '1' },
      { ORCA_LINUX_ARM64_RELEASE: '1' },
      { CI: 'true' },
      { GITHUB_ACTIONS: 'true' }
    ]) {
      expect(
        localPackagingOrcadTemplateTargets({
          ...release,
          ORCA_LOCAL_ORCAD_TARGETS: 'linux-arm64-glibc'
        })
      ).toBeNull()
    }
  })
})
