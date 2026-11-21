import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertBuiltFromCommit,
  buildLocalOrcadTemplate,
  runDocker
} from './build-local-orcad-template.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'local-orcad-template-'))
  dirs.push(dir)
  return dir
}

function stalePartialTemplate() {
  const outputDir = join(tempDir(), 'orcad-template')
  mkdirSync(join(outputDir, 'targets', 'linux-arm64-glibc'), { recursive: true })
  writeFileSync(join(outputDir, 'orcad-template.json'), '{}')
  return outputDir
}

describe('buildLocalOrcadTemplate', () => {
  it('removes a stale template when the step is turned off', async () => {
    const outputDir = stalePartialTemplate()
    await expect(
      buildLocalOrcadTemplate({ ORCA_LOCAL_ORCAD_TARGETS: 'none' }, { outputDir })
    ).resolves.toEqual(expect.objectContaining({ status: 'skipped' }))
    expect(existsSync(outputDir)).toBe(false)
  })

  it('removes a stale template when Docker is unavailable', async () => {
    const outputDir = stalePartialTemplate()
    const result = await buildLocalOrcadTemplate(
      {},
      { outputDir, dockerProgram: join(tempDir(), 'no-docker') }
    )
    expect(result.status).toBe('skipped')
    expect(existsSync(outputDir)).toBe(false)
  })

  it('removes a stale template when the build fails before copying', async () => {
    const outputDir = stalePartialTemplate()
    await expect(
      buildLocalOrcadTemplate({ ORCA_LOCAL_ORCAD_TARGETS: 'linux-arm64-musl' }, { outputDir })
    ).rejects.toThrow('linux-arm64-musl')
    expect(existsSync(outputDir)).toBe(false)
  })
})

describe('assertBuiltFromCommit', () => {
  it('accepts a template only from the expected commit', () => {
    const templateDir = tempDir()
    mkdirSync(join(templateDir, 'out'))
    writeFileSync(join(templateDir, 'out', 'package.json'), JSON.stringify({ commit: 'aaa111' }))
    expect(() => assertBuiltFromCommit('template', templateDir, 'aaa111')).not.toThrow()
    expect(() => assertBuiltFromCommit('template', templateDir, 'bbb222')).toThrow('aaa111')
  })

  it('accepts merged prebuilds only from the expected commit', () => {
    const src = tempDir()
    mkdirSync(join(src, 'out'))
    expect(() => assertBuiltFromCommit('prebuilds', src, 'aaa111')).toThrow()
    writeFileSync(join(src, 'out', 'orcad-prebuilds.commit'), 'bbb222\n')
    expect(() => assertBuiltFromCommit('prebuilds', src, 'aaa111')).toThrow('bbb222')
    writeFileSync(join(src, 'out', 'orcad-prebuilds.commit'), 'aaa111\n')
    expect(() => assertBuiltFromCommit('prebuilds', src, 'aaa111')).not.toThrow()
  })
})

// A docker CLI stuck on a dead daemon: it ignores SIGTERM and never exits on its own.
function stuckDocker() {
  const program = join(tempDir(), 'docker')
  writeFileSync(
    program,
    `#!/bin/sh\nexec "${process.execPath}" -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"\n`
  )
  chmodSync(program, 0o755)
  return program
}

describe.skipIf(process.platform === 'win32')('a stuck Docker', () => {
  it('returns from a bounded call within its timeout and grace', async () => {
    const startedAt = Date.now()
    const result = await runDocker(['info'], { program: stuckDocker(), timeoutMs: 300 })
    expect(result.timedOut).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(300 + 5_000)
  })

  it('skips the template and removes the stale one', async () => {
    const outputDir = stalePartialTemplate()
    const result = await buildLocalOrcadTemplate(
      { ORCA_LOCAL_ORCAD_DOCKER_INFO_TIMEOUT_MS: '300' },
      { outputDir, dockerProgram: stuckDocker() }
    )
    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('timed out')
    expect(existsSync(outputDir)).toBe(false)
  })
})

describe('a non-release CI build', () => {
  it('skips the step and leaves the output the CI job provided', async () => {
    const outputDir = stalePartialTemplate()
    const result = await buildLocalOrcadTemplate(
      { CI: 'true' },
      { outputDir, dockerProgram: join(tempDir(), 'no-docker') }
    )
    expect(result).toEqual(expect.objectContaining({ status: 'skipped' }))
    expect(result.reason).toContain('CI')
    expect(existsSync(outputDir)).toBe(true)
  })
})
