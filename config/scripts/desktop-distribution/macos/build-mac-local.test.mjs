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

function partialTemplate() {
  const root = mkdtempSync(join(tmpdir(), 'build-mac-local-'))
  dirs.push(root)
  const outputDir = join(root, 'orcad-template')
  mkdirSync(join(outputDir, 'targets', 'linux-arm64-glibc'), { recursive: true })
  writeFileSync(join(outputDir, 'orcad-template.json'), '{}')
  return outputDir
}

describe('localOrcadTemplateEnv', () => {
  it('packages no stale partial template when the step is turned off', async () => {
    const outputDir = partialTemplate()
    const env = await localOrcadTemplateEnv(
      { ORCA_LOCAL_ORCAD_TARGETS: 'none' },
      { outputDir, dockerProgram: join(outputDir, '..', 'no-docker') }
    )
    expect(existsSync(outputDir)).toBe(false)
    expect(env).toEqual({ ORCA_LOCAL_ORCAD_TARGETS: undefined })
  })

  it('leaves CI packaging as it was', async () => {
    const outputDir = partialTemplate()
    const env = await localOrcadTemplateEnv(
      { CI: 'true', ORCA_LOCAL_ORCAD_TARGETS: 'linux-arm64-glibc' },
      { outputDir, dockerProgram: join(outputDir, '..', 'no-docker') }
    )
    expect(existsSync(outputDir)).toBe(true)
    expect(env).toEqual({ ORCA_LOCAL_ORCAD_TARGETS: undefined })
  })
})
