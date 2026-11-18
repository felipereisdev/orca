import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTempDirs } from '../../testing/remove-temp-dirs.test-support'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getEphemeralVmRuntimeStorePath,
  listEphemeralVmRuntimes,
  updateEphemeralVmRuntimeStatus,
  upsertEphemeralVmRuntime
} from './ephemeral-vm-runtime-store'
import { getEphemeralVmRuntimeFeatureStorePath } from './ephemeral-vm-runtime-feature-store'
import { getEphemeralVmWriteAheadRuntimeStorePath } from './ephemeral-vm-runtime-write-ahead-store'
import { projectRuntimeForRollback } from './ephemeral-vm-runtime-rollback-projection'
import {
  requireEphemeralVmRecipeResult,
  RollbackEphemeralVmRuntimeRecordSchema,
  RollbackEphemeralVmRuntimeStoreSchema,
  type EphemeralVmRuntimeRecord
} from './ephemeral-vm-runtimes'

function runtimeRecord(
  overrides: Partial<EphemeralVmRuntimeRecord> = {}
): EphemeralVmRuntimeRecord {
  return {
    id: 'ordinary-runtime',
    recipeId: 'ordinary-recipe',
    recipe: {
      id: 'ordinary-recipe',
      name: 'Ordinary VM',
      create: './create.sh',
      destroy: './destroy.sh'
    },
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: 1_000,
    updatedAt: 1_000,
    recipeResult: {
      schemaVersion: 1,
      connection: {
        type: 'ssh',
        projectRoot: '/workspace/ordinary',
        target: {
          label: 'Ordinary VM',
          host: 'ordinary.example.com',
          port: 22,
          username: 'developer'
        }
      },
      userData: { resourceId: 'ordinary-resource' }
    },
    ...overrides
  }
}

describe('ephemeral VM runtime store rollback projection', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await removeTempDirs(tempDirs.splice(0))
  })

  function makeUserDataPath(): string {
    const path = mkdtempSync(join(tmpdir(), 'orca-vm-rollback-store-'))
    tempDirs.push(path)
    return path
  }

  it('never overwrites a write-ahead file it cannot read', () => {
    const userDataPath = makeUserDataPath()
    upsertEphemeralVmRuntime(userDataPath, runtimeRecord())
    const sidecarPath = getEphemeralVmWriteAheadRuntimeStorePath(userDataPath)
    const unreadable = '{"version":2,"runtimes":[{"id":"from-a-newer-build"}]}'
    writeFileSync(sidecarPath, unreadable)

    // Tracked VMs keep working, and the unreadable records survive the write.
    updateEphemeralVmRuntimeStatus(userDataPath, 'ordinary-runtime', { status: 'suspended' })
    expect(readFileSync(sidecarPath, 'utf8')).toBe(unreadable)

    // A new record that could not be kept is refused before its create starts.
    const { recipeResult: _recipeResult, ...writeAhead } = runtimeRecord({ id: 'new-runtime' })
    expect(() =>
      upsertEphemeralVmRuntime(userDataPath, { ...writeAhead, status: 'provisioning' })
    ).toThrow()
    expect(readFileSync(sidecarPath, 'utf8')).toBe(unreadable)
  })

  it('rollback projection drops desktop', () => {
    const runtime = requireEphemeralVmRecipeResult(runtimeRecord())
    const projected = projectRuntimeForRollback({
      ...runtime,
      recipeResult: {
        ...runtime.recipeResult,
        desktop: { type: 'vnc', port: 5901, host: '127.0.0.1', password: 'abc12345' }
      }
    })

    expect(projected.recipeResult).not.toHaveProperty('desktop')
    expect(RollbackEphemeralVmRuntimeRecordSchema.safeParse(projected).success).toBe(true)
  })

  it('keeps the recipe desktop across a store write and read', () => {
    const userDataPath = makeUserDataPath()
    const desktop = { type: 'vnc' as const, port: 5901, host: '127.0.0.1', password: 'abc12345' }
    upsertEphemeralVmRuntime(
      userDataPath,
      runtimeRecord({
        recipe: {
          id: 'ordinary-recipe',
          name: 'Ordinary VM',
          create: './create.sh',
          checkoutMode: 'provisioned-root'
        },
        recipeResult: {
          schemaVersion: 2,
          checkoutMode: 'provisioned-root',
          connection: {
            type: 'ssh',
            projectRoot: '/workspace/ordinary',
            target: {
              label: 'Ordinary VM',
              host: 'ordinary.example.com',
              port: 22,
              username: 'dev'
            }
          },
          desktop
        }
      })
    )

    expect(listEphemeralVmRuntimes(userDataPath)[0]?.recipeResult).toMatchObject({
      schemaVersion: 2,
      checkoutMode: 'provisioned-root',
      desktop
    })
    const mainStore = JSON.parse(readFileSync(getEphemeralVmRuntimeStorePath(userDataPath), 'utf8'))
    expect(RollbackEphemeralVmRuntimeStoreSchema.safeParse(mainStore).success).toBe(true)
    // Older builds parse checkout records strictly, so desktop lives in its own record.
    expect(
      JSON.parse(readFileSync(getEphemeralVmRuntimeFeatureStorePath(userDataPath), 'utf8')).records
    ).toEqual([
      {
        id: 'ordinary-runtime',
        recipeId: 'ordinary-recipe',
        createdAt: 1_000,
        recipeCheckoutMode: 'provisioned-root',
        resultCheckoutMode: 'provisioned-root'
      },
      {
        id: 'ordinary-runtime',
        recipeId: 'ordinary-recipe',
        createdAt: 1_000,
        resultDesktop: desktop
      }
    ])
  })

  it('lets an update add and then remove the desktop of a runtime without a checkout mode', () => {
    const userDataPath = makeUserDataPath()
    const runtime = requireEphemeralVmRecipeResult(runtimeRecord())
    const desktop = { type: 'vnc' as const, port: 5901, host: '127.0.0.1', password: 'abc12345' }
    upsertEphemeralVmRuntime(userDataPath, runtime)

    upsertEphemeralVmRuntime(userDataPath, {
      ...runtime,
      recipeResult: { ...runtime.recipeResult, desktop }
    })
    expect(listEphemeralVmRuntimes(userDataPath)[0]?.recipeResult?.desktop).toEqual(desktop)

    upsertEphemeralVmRuntime(userDataPath, runtime)
    expect(listEphemeralVmRuntimes(userDataPath)[0]?.recipeResult).not.toHaveProperty('desktop')
  })
})
