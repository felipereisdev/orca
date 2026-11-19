import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type { OrcaVmRecipe } from '../../shared/workspace-setup/orca-yaml-hook-types'
import { createEphemeralVmRuntimeStatsReader } from './runtime-stats'

const roots: string[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
})

afterEach(async () => {
  vi.useRealTimers()
  await removeTempDirs(roots.splice(0))
})

const runtime: EphemeralVmRuntimeRecord = {
  id: 'orca-runtime-1',
  recipeId: 'docker',
  workspaceId: 'workspace-1',
  status: 'running',
  cleanupStatus: 'not_started',
  createdAt: 1,
  updatedAt: 1,
  recipeResult: {
    schemaVersion: 1,
    connection: {
      type: 'ssh',
      target: { label: 'env', host: '127.0.0.1', port: 2222, username: 'dev' },
      projectRoot: '/workspace'
    }
  }
}

/** A repo whose stats script logs each run and prints `output` when the payload is a stats one. */
function statsRepo(output: string, exitCode = 0): { repoPath: string; runs: () => number } {
  const repoPath = mkdtempSync(join(tmpdir(), 'orca-vm-stats-'))
  roots.push(repoPath)
  const logPath = join(repoPath, 'runs.log')
  writeFileSync(logPath, '')
  writeFileSync(
    join(repoPath, 'stats.js'),
    [
      "const fs = require('node:fs')",
      "let input = ''",
      "process.stdin.on('data', (chunk) => { input += chunk })",
      "process.stdin.on('end', () => {",
      '  const payload = JSON.parse(input)',
      `  fs.appendFileSync(${JSON.stringify(logPath)}, payload.mode + ':' + payload.instanceId + '\\n')`,
      "  if (payload.mode !== 'stats' || !payload.recipeResult) process.exit(2)",
      `  process.stdout.write(${JSON.stringify(output)})`,
      `  process.exit(${exitCode})`,
      '})'
    ].join('\n')
  )
  return {
    repoPath,
    runs: () => readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
  }
}

function readerFor(repoPath: string, recipe: Partial<OrcaVmRecipe> = {}) {
  return createEphemeralVmRuntimeStatsReader({
    resolveTarget: async (runtimeId) =>
      runtimeId === runtime.id
        ? {
            runtime,
            repoPath,
            recipe: {
              id: 'docker',
              name: 'Docker',
              create: './create.sh',
              stats: `"${process.execPath}" stats.js`,
              ...recipe
            }
          }
        : null
  })
}

describe('readEphemeralVmRuntimeStats', () => {
  it('stats output parses and is cached for 15 s', async () => {
    const repo = statsRepo('{"cpuPercent":12.5,"memoryBytes":1048576,"diskBytes":2048}\n')
    const read = readerFor(repo.repoPath)

    const expected = { cpuPercent: 12.5, memoryBytes: 1048576, diskBytes: 2048 }
    await expect(read(runtime.id)).resolves.toEqual(expected)
    vi.setSystemTime(new Date('2026-11-19T12:00:14Z'))
    await expect(read(runtime.id)).resolves.toEqual(expected)
    expect(repo.runs()).toBe(1)

    vi.setSystemTime(new Date('2026-11-19T12:00:16Z'))
    await expect(read(runtime.id)).resolves.toEqual(expected)
    expect(repo.runs()).toBe(2)
  })

  it('a failing or missing stats step returns null without throwing', async () => {
    const valid = '{"cpuPercent":1,"memoryBytes":1,"diskBytes":1}'
    const noStep = statsRepo(valid)
    await expect(readerFor(noStep.repoPath, { stats: undefined })(runtime.id)).resolves.toBeNull()
    expect(noStep.runs()).toBe(0)

    const failing = statsRepo(valid, 1)
    await expect(readerFor(failing.repoPath)(runtime.id)).resolves.toBeNull()
    expect(failing.runs()).toBe(1)

    const negative = statsRepo('{"cpuPercent":-1,"memoryBytes":1,"diskBytes":1}')
    await expect(readerFor(negative.repoPath)(runtime.id)).resolves.toBeNull()
    const extraField = statsRepo('{"cpuPercent":1,"memoryBytes":1,"diskBytes":1,"token":"x"}')
    await expect(readerFor(extraField.repoPath)(runtime.id)).resolves.toBeNull()
    const notJson = statsRepo('cpu 12%')
    await expect(readerFor(notJson.repoPath)(runtime.id)).resolves.toBeNull()

    const unresolvable = createEphemeralVmRuntimeStatsReader({
      resolveTarget: () => Promise.reject(new Error('store unreadable'))
    })
    await expect(unresolvable(runtime.id)).resolves.toBeNull()
    await expect(readerFor(noStep.repoPath)('orca-unknown')).resolves.toBeNull()
  })

  it('concurrent reads of one runtime run the stats step once', async () => {
    const repo = statsRepo('{"cpuPercent":3,"memoryBytes":4,"diskBytes":5}')
    const read = readerFor(repo.repoPath)

    const results = await Promise.all([read(runtime.id), read(runtime.id), read(runtime.id)])

    expect(results).toEqual([
      { cpuPercent: 3, memoryBytes: 4, diskBytes: 5 },
      { cpuPercent: 3, memoryBytes: 4, diskBytes: 5 },
      { cpuPercent: 3, memoryBytes: 4, diskBytes: 5 }
    ])
    expect(repo.runs()).toBe(1)
  })

  it('a stalled target lookup returns null at the 5 s deadline', async () => {
    vi.useFakeTimers()
    const read = createEphemeralVmRuntimeStatsReader({
      resolveTarget: () => new Promise(() => {})
    })

    const pending = read(runtime.id)
    let settled: unknown = 'pending'
    void pending.then((value) => {
      settled = value
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBeNull()
  })
})
