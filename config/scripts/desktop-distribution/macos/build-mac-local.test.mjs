import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localOrcadTemplateEnv } from './build-mac-local.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('localOrcadTemplateEnv', () => {
  it('packages no stale partial template when the step is turned off', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-mac-local-'))
    dirs.push(root)
    const outputDir = join(root, 'orcad-template')
    mkdirSync(join(outputDir, 'targets', 'linux-arm64-glibc'), { recursive: true })
    writeFileSync(join(outputDir, 'orcad-template.json'), '{}')
    const env = localOrcadTemplateEnv({ ORCA_LOCAL_ORCAD_TARGETS: 'none' }, { outputDir })
    expect(existsSync(outputDir)).toBe(false)
    expect(env).toEqual({ ORCA_LOCAL_ORCAD_TARGETS: undefined })
  })
})
