import '../../shared/remote-runtime/host-store/environment-store-worker-test-fixture'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import {
  getEphemeralVmRuntimeStorePath,
  listEphemeralVmRuntimes,
  updateEphemeralVmRuntimeStatus
} from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import { getEphemeralVmRuntimeFeatureStorePath } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-feature-store'
import { getEphemeralVmWriteAheadRuntimeStorePath } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-write-ahead-store'
import type { OrcaVmRecipe } from '../../shared/workspace-setup/orca-yaml-hook-types'
import type { Store } from '../persistence/loading-store/store'
import { provisionEphemeralVmRuntime } from './runtime-service'
import { beginEphemeralVmProvisioning } from './runtime-provisioning-persistence'
import { createEphemeralVmRuntimeStatsReader, resolveRuntimeStatsTarget } from './runtime-stats'

// The recipe snapshot schema of the build before stats existed (abf28c0c5b3), which parses strictly.
const PreviousBuildRecipeSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    create: z.string().min(1),
    checkoutMode: z.enum(['orca-worktree', 'provisioned-root']).optional(),
    description: z.string().min(1).optional(),
    suspend: z.string().min(1).optional(),
    resume: z.string().min(1).optional(),
    destroy: z.string().min(1).optional(),
    destroyDisabled: z.boolean().optional()
  })
  .strict()
const PreviousBuildStoreFileSchema = z.object({
  version: z.literal(1),
  runtimes: z.array(z.object({ recipe: PreviousBuildRecipeSnapshotSchema.optional() }))
})

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await removeTempDirs(roots.splice(0))
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** A repo whose create prints an SSH result, with stats scripts that log their own name. */
function makeRepo() {
  const repoPath = tempDir('orca-vm-stats-approval-repo-')
  const userDataPath = tempDir('orca-vm-stats-approval-data-')
  const logPath = join(repoPath, 'runs.log')
  writeFileSync(logPath, '')
  writeFileSync(
    join(repoPath, 'create.js'),
    `process.stdout.write(${JSON.stringify(
      JSON.stringify({
        schemaVersion: 1,
        connection: {
          type: 'ssh',
          target: { label: 'env', host: '127.0.0.1', port: 2222, username: 'dev' },
          projectRoot: '/workspace'
        }
      })
    )})\n`
  )
  for (const name of ['approved', 'changed']) {
    writeFileSync(
      join(repoPath, `${name}.js`),
      `require('node:fs').appendFileSync(${JSON.stringify(logPath)}, '${name}\\n')\n` +
        `process.stdout.write('{"cpuPercent":1,"memoryBytes":2,"diskBytes":3}')\n`
    )
  }
  const command = (name: string): string => `"${process.execPath}" ${name}.js`
  const recipe = (stats?: string): OrcaVmRecipe => ({
    id: 'docker',
    name: 'Docker',
    create: command('create'),
    ...(stats ? { stats: command(stats) } : {})
  })
  const store = {
    getRepo: (id: string) =>
      id === 'repo-1'
        ? { id, path: repoPath, displayName: 'repo', badgeColor: '', addedAt: 1 }
        : undefined
  }
  const read = createEphemeralVmRuntimeStatsReader({
    resolveTarget: (runtimeId) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver only calls getRepo.
      resolveRuntimeStatsTarget(store as unknown as Store, userDataPath, runtimeId)
  })
  /** orca.yaml as the user edits it after the approval: the same create, another stats command. */
  const editYamlStats = (): void =>
    writeFileSync(
      join(repoPath, 'orca.yaml'),
      [
        'environmentRecipes:',
        '  - id: docker',
        '    name: Docker',
        `    create: '${command('create')}'`,
        `    stats: '${command('changed')}'`
      ].join('\n')
    )
  const provision = async (approvedRecipe: OrcaVmRecipe) => {
    const result = await provisionEphemeralVmRuntime({
      userDataPath,
      repoPath,
      repoId: 'repo-1',
      recipe: approvedRecipe
    })
    if (!result.ok) {
      throw new Error(result.start.error)
    }
    return result.runtime.id
  }
  return {
    userDataPath,
    repoPath,
    logPath,
    command,
    recipe,
    read,
    provision,
    editYamlStats,
    runs: () => readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('runtime stats approval', () => {
  it('a runtime created with an approved stats command runs exactly that one', async () => {
    const env = makeRepo()
    const runtimeId = await env.provision(env.recipe('approved'))
    env.editYamlStats()
    // Later lifecycle writes rewrite the sidecar; the approved command must survive them.
    updateEphemeralVmRuntimeStatus(env.userDataPath, runtimeId, { updatedAt: 2 })

    await expect(env.read(runtimeId)).resolves.toEqual({
      cpuPercent: 1,
      memoryBytes: 2,
      diskBytes: 3
    })
    expect(env.runs()).toEqual(['approved'])
  })

  it('stats run with the environment approved at creation, not one added to orca.yaml later', async () => {
    const env = makeRepo()
    vi.stubEnv('ORCA_STATS_APPROVED', 'shown')
    vi.stubEnv('ORCA_STATS_SECRET', 'host-secret')
    writeFileSync(
      join(env.repoPath, 'env-probe.js'),
      `require('node:fs').appendFileSync(${JSON.stringify(env.logPath)}, ` +
        `[process.env.ORCA_STATS_APPROVED, process.env.ORCA_STATS_SECRET ?? 'unset'].join(' ') + '\\n')\n` +
        `process.stdout.write('{"cpuPercent":1,"memoryBytes":2,"diskBytes":3}')\n`
    )
    const runtimeId = await env.provision({
      ...env.recipe(),
      stats: env.command('env-probe'),
      passEnv: ['ORCA_STATS_APPROVED']
    })
    writeFileSync(
      join(env.repoPath, 'orca.yaml'),
      [
        'environmentRecipes:',
        '  - id: docker',
        '    name: Docker',
        `    create: '${env.command('create')}'`,
        `    stats: '${env.command('env-probe')}'`,
        '    passEnv: [ORCA_STATS_APPROVED, ORCA_STATS_SECRET]'
      ].join('\n')
    )

    await expect(env.read(runtimeId)).resolves.not.toBeNull()
    expect(env.runs()).toEqual(['shown unset'])
  })

  it('a stats command added to orca.yaml after creation never runs', async () => {
    const env = makeRepo()
    const runtimeId = await env.provision(env.recipe())
    env.editYamlStats()

    await expect(env.read(runtimeId)).resolves.toBeNull()
    expect(env.runs()).toEqual([])
  })

  it('the main and write-ahead files still parse with the previous build schema', async () => {
    const env = makeRepo()
    await env.provision(env.recipe('approved'))
    // An interrupted provision: its write-ahead record never got a result.
    beginEphemeralVmProvisioning({
      userDataPath: env.userDataPath,
      repoPath: tempDir('orca-vm-stats-interrupted-'),
      recipe: env.recipe('approved')
    })

    const main = PreviousBuildStoreFileSchema.safeParse(
      readJson(getEphemeralVmRuntimeStorePath(env.userDataPath))
    )
    const writeAhead = PreviousBuildStoreFileSchema.safeParse(
      readJson(getEphemeralVmWriteAheadRuntimeStorePath(env.userDataPath))
    )
    expect(main.success && main.data.runtimes).toHaveLength(1)
    expect(writeAhead.success && writeAhead.data.runtimes).toHaveLength(1)
  })

  it('an unreadable sidecar gives no stats', async () => {
    const env = makeRepo()
    const runtimeId = await env.provision(env.recipe('approved'))
    writeFileSync(getEphemeralVmRuntimeFeatureStorePath(env.userDataPath), '{ not json')

    await expect(env.read(runtimeId)).resolves.toBeNull()
    expect(env.runs()).toEqual([])
  })

  it('a failed stats write warns once and never fails the provision', async () => {
    const env = makeRepo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A sidecar this build cannot read is never overwritten, so the stats write fails.
    writeFileSync(getEphemeralVmRuntimeFeatureStorePath(env.userDataPath), '{ not json')

    const runtimeId = await env.provision(env.recipe('approved'))

    expect(listEphemeralVmRuntimes(env.userDataPath)).toMatchObject([
      { id: runtimeId, status: 'running' }
    ])
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.join(' '))).not.toContain('approved.js')
    await expect(env.read(runtimeId)).resolves.toBeNull()
  })

  it('a stats command too large for the sidecar keeps the required metadata', async () => {
    const env = makeRepo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const recipe: OrcaVmRecipe = {
      ...env.recipe(),
      checkoutMode: 'orca-worktree',
      stats: `./stats.sh ${'x'.repeat(1_100_000)}`
    }

    const runtimeId = await env.provision(recipe)

    expect(listEphemeralVmRuntimes(env.userDataPath)).toMatchObject([
      { id: runtimeId, status: 'running', recipe: { checkoutMode: 'orca-worktree' } }
    ])
    expect(warn).toHaveBeenCalledOnce()
    await expect(env.read(runtimeId)).resolves.toBeNull()
  })
})
