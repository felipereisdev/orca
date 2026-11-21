import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireLocalOrcadCacheLock,
  assertTemplateFromCommit,
  buildLocalOrcadTemplate
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
  it('removes a stale template when the step is turned off', () => {
    const outputDir = stalePartialTemplate()
    expect(buildLocalOrcadTemplate({ ORCA_LOCAL_ORCAD_TARGETS: 'none' }, { outputDir })).toEqual(
      expect.objectContaining({ status: 'skipped' })
    )
    expect(existsSync(outputDir)).toBe(false)
  })

  it('removes a stale template when Docker is unavailable', () => {
    const outputDir = stalePartialTemplate()
    const result = buildLocalOrcadTemplate(
      {},
      { outputDir, dockerProgram: join(tempDir(), 'no-docker') }
    )
    expect(result.status).toBe('skipped')
    expect(existsSync(outputDir)).toBe(false)
  })

  it('removes a stale template when the build fails before copying', () => {
    const outputDir = stalePartialTemplate()
    expect(() =>
      buildLocalOrcadTemplate({ ORCA_LOCAL_ORCAD_TARGETS: 'linux-arm64-musl' }, { outputDir })
    ).toThrow('linux-arm64-musl')
    expect(existsSync(outputDir)).toBe(false)
  })
})

describe('assertTemplateFromCommit', () => {
  it('accepts only a template built from the expected commit', () => {
    const templateDir = tempDir()
    mkdirSync(join(templateDir, 'out'))
    writeFileSync(join(templateDir, 'out', 'package.json'), JSON.stringify({ commit: 'aaa111' }))
    expect(() => assertTemplateFromCommit(templateDir, 'aaa111')).not.toThrow()
    expect(() => assertTemplateFromCommit(templateDir, 'bbb222')).toThrow('aaa111')
  })
})

describe('acquireLocalOrcadCacheLock', () => {
  it('refuses a lock a live build holds', () => {
    const lockPath = join(tempDir(), '.lock')
    const release = acquireLocalOrcadCacheLock(lockPath, { waitMs: 0 })
    expect(() => acquireLocalOrcadCacheLock(lockPath, { waitMs: 0 })).toThrow(String(process.pid))
    release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('reclaims a lock its dead owner left behind', () => {
    const lockPath = join(tempDir(), '.lock')
    writeFileSync(lockPath, JSON.stringify({ pid: 2 ** 22 + 1 }))
    const release = acquireLocalOrcadCacheLock(lockPath, { waitMs: 0 })
    expect(existsSync(lockPath)).toBe(true)
    release()
  })
})
