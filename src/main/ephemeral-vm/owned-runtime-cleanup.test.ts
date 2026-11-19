import '../../shared/remote-runtime/host-store/environment-store-worker-test-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEphemeralVmRecipeResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { upsertEphemeralVmRuntime } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'

const mocks = vi.hoisted(() => ({
  userData: '',
  destroy: vi.fn(),
  start: vi.fn(async () => {}),
  stop: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('./runtime-service', () => ({ cleanupEphemeralVmRuntime: mocks.destroy }))
vi.mock('../ipc/ephemeral-vm/ephemeral-vm-recipe-context', () => ({
  getRuntimeRecipeContext: () => ({ repoPath: '/repo', recipe: { id: 'cloud', destroy: 'x' } })
}))
vi.mock('./runtime-environment-release', () => ({
  releaseEphemeralVmRuntimeEnvironments: async () => {}
}))
vi.mock('./runtime-ssh-cleanup', () => ({
  removeEphemeralVmRuntimeSshTarget: async (args: { runtime: EphemeralVmRuntimeRecord }) =>
    args.runtime
}))
vi.mock('./desktop-sync-registry', () => ({
  startEnvironmentDesktop: mocks.start,
  stopEnvironmentDesktop: mocks.stop
}))

import { cleanupOwnedEphemeralVmRuntime } from './owned-runtime-cleanup'
import { rollbackRecipeRemovalAck } from './recipe-removal-ack-handlers'
import { noteUnattachedProvision } from './unattached-provisions'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the cleanup reads only getSettings, and the recipe context it would read is mocked above.
const STORE = { getSettings: () => ({ experimentalEphemeralVms: true }) } as unknown as Parameters<
  typeof cleanupOwnedEphemeralVmRuntime
>[0]
const dirs: string[] = []

function provisionedRoot(
  overrides: Partial<EphemeralVmRuntimeRecord> = {}
): EphemeralVmRuntimeRecord {
  const parsed = parseEphemeralVmRecipeResult(
    JSON.stringify({
      schemaVersion: 2,
      checkoutMode: 'provisioned-root',
      connection: {
        type: 'ssh',
        projectRoot: '/workspace/repo',
        target: { label: 'VM', host: 'vm.example.com', port: 22, username: 'root' }
      }
    })
  )
  if (!parsed.ok) {
    throw new Error('fixture recipe result did not parse')
  }
  const record: EphemeralVmRuntimeRecord = {
    id: 'vm-root',
    recipeId: 'cloud',
    repoId: 'repo',
    runtimeEnvironmentId: 'env-a',
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: 1,
    updatedAt: 1,
    recipeResult: parsed.result,
    ...overrides
  }
  upsertEphemeralVmRuntime(mocks.userData, record)
  return record
}

beforeEach(() => {
  mocks.userData = mkdtempSync(join(tmpdir(), 'orca-owned-cleanup-'))
  dirs.push(mocks.userData)
  mocks.destroy.mockReset()
  mocks.start.mockClear()
  mocks.stop.mockClear()
})
afterEach(() => removeTempDirs(dirs.splice(0)))

describe('destroying a recipe environment from the desktop', () => {
  it('a failed provisioned-root setup rolls back with the ack main issues for it', async () => {
    const record = provisionedRoot()
    noteUnattachedProvision(record.id)
    mocks.destroy.mockImplementation(async () => ({
      ok: true,
      runtime: { ...record, status: 'cleaned' }
    }))
    const ack = await rollbackRecipeRemovalAck(mocks.userData, { runtimeId: record.id })
    expect(ack).not.toBe('')
    await expect(
      cleanupOwnedEphemeralVmRuntime(STORE, mocks.userData, record.id, { ack })
    ).resolves.toMatchObject({ status: 'cleaned' })
  })

  it('refuses a rollback ack for a record that holds a workspace', async () => {
    const record = provisionedRoot({ id: 'vm-attached', workspaceId: 'repo::/workspace/repo' })
    noteUnattachedProvision(record.id)
    const ack = await rollbackRecipeRemovalAck(mocks.userData, { runtimeId: record.id })
    expect(ack).toBe('')
    await expect(
      cleanupOwnedEphemeralVmRuntime(STORE, mocks.userData, record.id, { ack })
    ).rejects.toThrow('not confirmed')
    expect(mocks.destroy).not.toHaveBeenCalled()
  })

  it('a destroy that rejects restarts the recordings sync', async () => {
    const record = provisionedRoot({ id: 'vm-reject' })
    noteUnattachedProvision(record.id)
    mocks.destroy.mockRejectedValue(new Error('runtime store write failed'))
    const ack = await rollbackRecipeRemovalAck(mocks.userData, { runtimeId: record.id })
    await expect(
      cleanupOwnedEphemeralVmRuntime(STORE, mocks.userData, record.id, { ack })
    ).rejects.toThrow('runtime store write failed')
    expect(mocks.stop).toHaveBeenCalledWith(record.id)
    expect(mocks.start).toHaveBeenCalledWith(STORE, expect.objectContaining({ id: record.id }))
  })
})
