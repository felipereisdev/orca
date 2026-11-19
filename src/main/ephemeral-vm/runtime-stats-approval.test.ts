import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import {
  getEphemeralVmRuntimeStorePath,
  upsertEphemeralVmRuntime
} from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import { toEphemeralVmRuntimeRecipeSnapshot } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-timeouts'
import type { OrcaVmRecipe } from '../../shared/workspace-setup/orca-yaml-hook-types'
import type { Store } from '../persistence/loading-store/store'
import { createEphemeralVmRuntimeStatsReader, resolveRuntimeStatsTarget } from './runtime-stats'

const roots: string[] = []

afterEach(async () => {
  await removeTempDirs(roots.splice(0))
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** A repo with two stats scripts that log their own name, and an orca.yaml naming `yamlStats`. */
function setup(approvedStats: string | undefined) {
  const repoPath = tempDir('orca-vm-stats-approval-repo-')
  const userDataPath = tempDir('orca-vm-stats-approval-data-')
  const logPath = join(repoPath, 'runs.log')
  writeFileSync(logPath, '')
  for (const name of ['approved', 'changed']) {
    writeFileSync(
      join(repoPath, `${name}.js`),
      `require('node:fs').appendFileSync(${JSON.stringify(logPath)}, '${name}\\n')\n` +
        `process.stdout.write('{"cpuPercent":1,"memoryBytes":2,"diskBytes":3}')\n`
    )
  }
  const command = (name: string): string => `"${process.execPath}" ${name}.js`
  writeFileSync(
    join(repoPath, 'orca.yaml'),
    [
      'environmentRecipes:',
      '  - id: docker',
      '    name: Docker',
      '    create: ./create.sh',
      `    stats: '${command('changed')}'`
    ].join('\n')
  )
  const recipe: OrcaVmRecipe = {
    id: 'docker',
    name: 'Docker',
    create: './create.sh',
    ...(approvedStats ? { stats: command(approvedStats) } : {})
  }
  upsertEphemeralVmRuntime(userDataPath, {
    id: 'orca-runtime-1',
    recipeId: 'docker',
    recipe: toEphemeralVmRuntimeRecipeSnapshot(recipe),
    repoId: 'repo-1',
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
  return {
    read,
    runs: () => readFileSync(logPath, 'utf8').split('\n').filter(Boolean),
    mainStoreText: () => readFileSync(getEphemeralVmRuntimeStorePath(userDataPath), 'utf8')
  }
}

describe('runtime stats approval', () => {
  it('a runtime created with an approved stats command runs exactly that one', async () => {
    const env = setup('approved')

    await expect(env.read('orca-runtime-1')).resolves.toEqual({
      cpuPercent: 1,
      memoryBytes: 2,
      diskBytes: 3
    })
    expect(env.runs()).toEqual(['approved'])
    // Older builds parse the main file's recipe snapshot strictly; the command lives in the sidecar.
    expect(env.mainStoreText()).not.toContain('approved.js')
  })

  it('a stats command added to orca.yaml after creation never runs', async () => {
    const env = setup(undefined)

    await expect(env.read('orca-runtime-1')).resolves.toBeNull()
    expect(env.runs()).toEqual([])
  })
})
