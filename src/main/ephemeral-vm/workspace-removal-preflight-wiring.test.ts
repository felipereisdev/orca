import '../../shared/remote-runtime/host-store/environment-store-worker-test-fixture'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEphemeralVmRecipeResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { upsertEphemeralVmRuntime } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import { getEphemeralVmRuntimeFeatureStorePath } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-feature-store'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'

type Handler = (event: unknown, args: unknown) => Promise<unknown>
const mocks = vi.hoisted(() => ({
  userData: '',
  experiment: true,
  handlers: new Map<string, Handler>(),
  call: vi.fn(),
  keep: vi.fn(),
  stop: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  ipcMain: {
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.call
}))
vi.mock('./desktop-recording-sync', () => ({ keepRecordingOnMac: mocks.keep }))
vi.mock('./desktop-sync-registry', () => ({ stopEnvironmentDesktop: mocks.stop }))

import { registerRecipeRemovalPreflightHandlers } from './workspace-removal-preflight-wiring'

const WORKSPACE = 'repo::/workspace/repo-task'
const REC = { id: 'aaaaaaaaaaaaaaaa', path: '/rec/rec-aaaaaaaaaaaaaaaa.mp4', bytes: 10 }
const dirs: string[] = []

function seed(id: string, environmentId: string | null): void {
  const parsed = parseEphemeralVmRecipeResult(
    JSON.stringify({
      schemaVersion: 1,
      connection: {
        type: 'ssh',
        projectRoot: '/workspace/repo',
        target: { label: 'VM', host: 'vm.example.com', port: 22, username: 'root' }
      },
      desktop: { type: 'vnc', port: 5901, password: 'abc12345' }
    })
  )
  if (!parsed.ok) {
    throw new Error('fixture recipe result did not parse')
  }
  upsertEphemeralVmRuntime(mocks.userData, {
    id,
    recipeId: 'cloud',
    repoId: 'repo',
    workspaceId: WORKSPACE,
    ...(environmentId ? { runtimeEnvironmentId: environmentId } : { sshTargetId: 'ssh-1' }),
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: id === 'vm-a' ? 1 : 2,
    updatedAt: 1,
    recipeResult: parsed.result
  })
}

/** A provisioned root adopted before workspaces were recorded on the runtime. */
function seedLegacyRoot(id: string, environmentId: string): void {
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
  upsertEphemeralVmRuntime(mocks.userData, {
    id,
    recipeId: 'cloud',
    repoId: 'repo',
    runtimeEnvironmentId: environmentId,
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: 3,
    updatedAt: 1,
    recipeResult: parsed.result
  })
}

function invoke(channel: string, args: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

beforeEach(() => {
  mocks.userData = mkdtempSync(join(tmpdir(), 'orca-removal-preflight-'))
  dirs.push(mocks.userData)
  mocks.experiment = true
  mocks.call.mockReset().mockImplementation(async (_root, _env, method: string) => ({
    id: 'r',
    ok: true,
    _meta: { runtimeId: 'env' },
    result:
      method === 'desktop.recordings.list'
        ? { recordings: mocks.keep.mock.calls.length > 0 ? [] : [REC], inProgress: false }
        : method === 'git.unpushedCommitCount'
          ? { unpushedCommits: 0 }
          : { entries: [], conflictOperation: 'unknown' }
  }))
  mocks.keep.mockReset().mockResolvedValue(undefined)
  mocks.stop.mockReset()
  registerRecipeRemovalPreflightHandlers({
    getSettings: () => ({ experimentalEphemeralVms: mocks.experiment })
  })
})
afterEach(() => removeTempDirs(dirs.splice(0)))

describe('recipe removal preflight wiring', () => {
  it('two hosts publish the same workspace id: the check and the copy reach the right VM', async () => {
    seed('vm-a', 'env-a')
    seed('vm-b', 'env-b')
    const request = { hostId: 'runtime:env-b', workspaceId: WORKSPACE }

    await expect(invoke('ephemeralVm:removalPreflight', request)).resolves.toMatchObject({
      status: 'unsafe',
      recordingsNotCopied: [REC]
    })
    const environments = new Set(mocks.call.mock.calls.map(([, env]) => env))
    expect([...environments]).toEqual(['id:env-b'])

    await expect(invoke('ephemeralVm:copyRecordingsBeforeRemoval', request)).resolves.toEqual({
      ok: true,
      copied: 1,
      ack: expect.any(String)
    })
    expect(mocks.keep).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: 'env-b', workspaceId: WORKSPACE, recording: REC })
    )
    // The destroy owns stopping the desktop's sync; a removal that fails later keeps it running.
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('an unreadable feature store is unchecked, never a desktop-free clean', async () => {
    seed('vm-a', 'env-a')
    writeFileSync(getEphemeralVmRuntimeFeatureStorePath(mocks.userData), '{not json')
    await expect(
      invoke('ephemeralVm:removalPreflight', { hostId: 'runtime:env-a', workspaceId: WORKSPACE })
    ).resolves.toMatchObject({
      status: 'unchecked',
      reason: 'store_unreadable',
      ack: expect.any(String)
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('a feature record the parser drops is unchecked, never a desktop-free clean', async () => {
    seed('vm-a', 'env-a')
    writeFileSync(
      getEphemeralVmRuntimeFeatureStorePath(mocks.userData),
      JSON.stringify({ version: 1, records: [{ kind: 'desktop', runtimeId: 'vm-a' }] })
    )
    await expect(
      invoke('ephemeralVm:removalPreflight', { hostId: 'runtime:env-a', workspaceId: WORKSPACE })
    ).resolves.toMatchObject({ status: 'unchecked', reason: 'store_unreadable' })
  })

  it('an older provisioned root with no recorded workspace is unchecked when named by id', async () => {
    seedLegacyRoot('vm-root', 'env-a')
    await expect(
      invoke('ephemeralVm:removalPreflight', { runtimeId: 'vm-root' })
    ).resolves.toMatchObject({
      status: 'unchecked',
      reason: 'workspace_unrecorded',
      ack: expect.any(String)
    })
  })

  it('an owner with no Orca server to ask is unchecked, not skipped', async () => {
    seed('vm-a', null)
    await expect(
      invoke('ephemeralVm:removalPreflight', { hostId: 'ssh:ssh-1', workspaceId: WORKSPACE })
    ).resolves.toMatchObject({
      status: 'unchecked',
      reason: 'no_orca_server',
      ack: expect.any(String)
    })
  })

  it('a workspace no recipe owns on that host, or the experiment off, keeps today’s dialog', async () => {
    seed('vm-a', 'env-a')
    await expect(
      invoke('ephemeralVm:removalPreflight', { hostId: 'runtime:env-z', workspaceId: WORKSPACE })
    ).resolves.toBeNull()
    mocks.experiment = false
    await expect(
      invoke('ephemeralVm:removalPreflight', { hostId: 'runtime:env-a', workspaceId: WORKSPACE })
    ).resolves.toBeNull()
    expect(mocks.call).not.toHaveBeenCalled()
  })
})
