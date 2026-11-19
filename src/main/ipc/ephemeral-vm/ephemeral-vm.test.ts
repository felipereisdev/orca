import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTempDirs } from '../../../shared/testing/remove-temp-dirs.test-support'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePairingOffer } from '../../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { getEphemeralVmRuntimeStorePath } from '../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import { desktopEnvironmentFake as desktopEnv } from '../../ephemeral-vm/desktop-environment-fake.test-support'

const handlers = new Map<string, (_event: unknown, args: never) => unknown>()
const {
  handleMock,
  removeHandlerMock,
  getPathMock,
  connectRuntimeOwnedSshTargetMock,
  disconnectRuntimeOwnedSshTargetMock,
  removeRuntimeOwnedSshTargetMock,
  invalidateRuntimeEnvironmentTransportMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  getPathMock: vi.fn(),
  connectRuntimeOwnedSshTargetMock: vi.fn(),
  disconnectRuntimeOwnedSshTargetMock: vi.fn(),
  removeRuntimeOwnedSshTargetMock: vi.fn(),
  invalidateRuntimeEnvironmentTransportMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getPath: getPathMock
  },
  ipcMain: {
    handle: handleMock,
    removeHandler: removeHandlerMock
  }
}))

vi.mock('../../ephemeral-vm/runtime-ssh', () => ({
  connectRuntimeOwnedSshTarget: connectRuntimeOwnedSshTargetMock,
  disconnectRuntimeOwnedSshTarget: disconnectRuntimeOwnedSshTargetMock,
  removeRuntimeOwnedSshTarget: removeRuntimeOwnedSshTargetMock
}))

vi.mock('../runtime-environments/runtime-environments', () => ({
  invalidateRuntimeEnvironmentTransport: invalidateRuntimeEnvironmentTransportMock
}))

vi.mock('../runtime-environments/requests/runtime-environment-transport-routing', async () =>
  (
    await import('../../ephemeral-vm/desktop-environment-fake.test-support')
  ).fakeTransportRoutingModule()
)

import { registerEphemeralVmHandlers } from './ephemeral-vm'
import { stopEnvironmentDesktop } from '../../ephemeral-vm/desktop-sync-registry'

const tempDirs: string[] = []

afterEach(async () => {
  await removeTempDirs(tempDirs.splice(0))
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** Calls a registered IPC handler; the map erases its argument and result types. */
async function invokeHandler<T>(channel: string, args: unknown): Promise<T> {
  const handler = handlers.get(channel)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each caller names the handler's own argument and result types.
  return (await handler?.(null, args as never)) as T
}

function makePairingCode(): string {
  return encodePairingOffer({
    v: PAIRING_OFFER_VERSION,
    endpoint: 'wss://sandbox.example.com',
    deviceToken: 'token',
    publicKeyB64: 'public-key'
  })
}

function makeStore(repoPath: string) {
  const repo = {
    id: 'repo-1',
    path: repoPath,
    displayName: 'Repo',
    badgeColor: '#000',
    addedAt: 0
  }
  let activeRuntimeEnvironmentId: string | null = null
  return {
    getRepo: vi.fn((repoId: string) => (repoId === 'repo-1' ? repo : null)),
    getRepos: vi.fn(() => [repo]),
    getSettings: vi.fn(() => ({ activeRuntimeEnvironmentId, experimentalEphemeralVms: true })),
    updateSettings: vi.fn((updates: { activeRuntimeEnvironmentId: string | null }) => {
      activeRuntimeEnvironmentId = updates.activeRuntimeEnvironmentId
    })
  }
}

function nodeCommand(scriptPath: string): string {
  return `"${process.execPath}" "${scriptPath}"`
}

function pluginServiceWithRecipes(
  recipes: { pluginKey: string; recipe: Record<string, unknown> }[]
) {
  return {
    whenReady: vi.fn().mockResolvedValue(undefined),
    contentPacks: { vmRecipes: { list: vi.fn(() => recipes) } }
  }
}

describe('registerEphemeralVmHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    getPathMock.mockReset()
    connectRuntimeOwnedSshTargetMock.mockReset()
    disconnectRuntimeOwnedSshTargetMock.mockReset()
    removeRuntimeOwnedSshTargetMock.mockReset()
    invalidateRuntimeEnvironmentTransportMock.mockReset()
    connectRuntimeOwnedSshTargetMock.mockResolvedValue({
      targetId: 'runtime-ssh-orca-instance-1',
      target: {
        id: 'runtime-ssh-orca-instance-1',
        label: 'Sandbox',
        host: 'sandbox.example.com',
        port: 22,
        username: 'root'
      }
    })
    disconnectRuntimeOwnedSshTargetMock.mockResolvedValue(undefined)
    removeRuntimeOwnedSshTargetMock.mockResolvedValue(undefined)
    handleMock.mockImplementation((channel: string, handler: never) => {
      handlers.set(channel, handler)
    })
  })

  it('uses an immutable plugin recipe snapshot after the plugin is removed', async () => {
    const userDataPath = makeDir('orca-ephemeral-vm-ipc-user-data-')
    const repoPath = makeDir('orca-ephemeral-vm-ipc-repo-')
    getPathMock.mockReturnValue(userDataPath)
    const startPath = join(repoPath, 'start.js')
    const destroyPath = join(repoPath, 'destroy.js')
    writeFileSync(
      startPath,
      `console.log(${JSON.stringify(
        JSON.stringify({
          schemaVersion: 1,
          pairingCode: makePairingCode(),
          projectRoot: '/workspace/repo'
        })
      )})`
    )
    writeFileSync(destroyPath, "require('fs').writeFileSync('plugin-cleaned.txt', 'yes')")
    const registrations = [
      {
        pluginKey: 'samples.recipes',
        recipe: {
          id: 'plugin-cloud',
          name: 'Plugin Cloud',
          create: nodeCommand(startPath),
          destroy: nodeCommand(destroyPath)
        }
      }
    ]
    const pluginService = pluginServiceWithRecipes(registrations)
    registerEphemeralVmHandlers(makeStore(repoPath) as never, pluginService as never)

    const provisioned = (await handlers.get('ephemeralVm:provision')?.(null, {
      repoId: 'repo-1',
      recipeId: 'plugin-cloud'
    } as never)) as { ok: true; runtime: { id: string; recipe?: { id: string } } }
    registrations.splice(0)
    // Never attached to a workspace, so there is nothing to acknowledge.
    const cleaned = await invokeHandler('ephemeralVm:cleanup', {
      runtimeId: provisioned.runtime.id,
      ack: ''
    })

    expect(provisioned.runtime.recipe).toMatchObject({ id: 'plugin-cloud' })
    expect(cleaned).toEqual(expect.objectContaining({ status: 'cleaned' }))
    expect(readFileSync(join(repoPath, 'plugin-cleaned.txt'), 'utf8')).toBe('yes')
  })
  it('an unreadable VM store does not abort handler registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const userDataPath = makeDir('orca-ephemeral-vm-bad-store-')
    getPathMock.mockReturnValue(userDataPath)
    writeFileSync(getEphemeralVmRuntimeStorePath(userDataPath), '{not json')
    try {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub store covers every Store method registration and these handlers use.
      const store = makeStore(makeDir('orca-ephemeral-vm-repo-')) as never
      expect(() => registerEphemeralVmHandlers(store)).not.toThrow()
      expect(handlers.has('ephemeralVm:provision')).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  describe('with a recipe desktop', () => {
    const DESKTOP = { type: 'vnc', port: 5901, password: 'abc12345' }
    const SSH_CONNECTION = {
      type: 'ssh',
      projectRoot: '/workspace/repo',
      target: { label: 'Sandbox', host: 'sandbox.example.com', port: 22, username: 'root' }
    }
    const runtimeIds: string[] = []

    afterEach(() => {
      runtimeIds.splice(0).forEach((id) => stopEnvironmentDesktop(id))
      desktopEnv.reset()
    })

    async function provisionWithDesktop(
      connection: Record<string, unknown>,
      options: { destroyExitCode?: number } = {}
    ) {
      const userDataPath = makeDir('orca-ephemeral-vm-desktop-user-data-')
      const repoPath = makeDir('orca-ephemeral-vm-desktop-repo-')
      getPathMock.mockReturnValue(userDataPath)
      const destroyPath = join(repoPath, 'destroy.js')
      writeFileSync(destroyPath, `process.exit(${options.destroyExitCode ?? 0})`)
      const startPath = join(repoPath, 'start.js')
      writeFileSync(
        startPath,
        `console.log(${JSON.stringify(
          JSON.stringify({ schemaVersion: 1, connection, desktop: DESKTOP })
        )})`
      )
      const pluginService = pluginServiceWithRecipes([
        {
          pluginKey: 'samples.recipes',
          recipe: {
            id: 'desktop-cloud',
            name: 'Desktop Cloud',
            create: nodeCommand(startPath),
            destroy: nodeCommand(destroyPath)
          }
        }
      ])
      registerEphemeralVmHandlers(makeStore(repoPath) as never, pluginService as never)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases IPC argument and result types; these are the provision handler's.
      const provisioned = (await handlers.get('ephemeralVm:provision')?.(null, {
        repoId: 'repo-1',
        recipeId: 'desktop-cloud'
      } as never)) as {
        ok: boolean
        runtime: { id: string; runtimeEnvironmentId?: string }
      }
      runtimeIds.push(provisioned.runtime.id)
      return { provisioned, userDataPath }
    }

    /** The acknowledgement the removal check issues for this workspace on the runtime's host. */
    async function removalAck(
      runtime: { runtimeEnvironmentId?: string },
      workspaceId: string
    ): Promise<string> {
      const checked = await invokeHandler<{ ack: string } | null>('ephemeralVm:removalPreflight', {
        hostId: `runtime:${runtime.runtimeEnvironmentId}`,
        workspaceId
      })
      if (!checked?.ack) {
        throw new Error('the removal check issued no ack')
      }
      // The fake environment answers no git check, so the answer waits for "Remove anyway".
      await invokeHandler('ephemeralVm:confirmRemoval', { ack: checked.ack })
      return checked.ack
    }

    function configureCalls() {
      return desktopEnv.calls.filter((call) => call.method === 'desktop.configure')
    }

    it('configures the connected Orca server after provisioning', async () => {
      const { provisioned } = await provisionWithDesktop({
        type: 'orca-server',
        pairingCode: makePairingCode(),
        projectRoot: '/workspace/repo'
      })

      expect(provisioned.ok).toBe(true)
      await vi.waitFor(() => expect(configureCalls()).toHaveLength(1))
      expect(configureCalls()[0]).toEqual({
        environmentId: provisioned.runtime.runtimeEnvironmentId,
        method: 'desktop.configure',
        params: { host: '127.0.0.1', port: 5901, password: 'abc12345' }
      })
    })

    it('configures the SSH-managed server after provisioning', async () => {
      connectRuntimeOwnedSshTargetMock.mockResolvedValueOnce({
        targetId: 'runtime-ssh-desktop',
        environmentId: 'ssh-env-1',
        target: { id: 'runtime-ssh-desktop', label: 'Sandbox', host: 'h', port: 22, username: 'r' }
      })
      const { provisioned } = await provisionWithDesktop(SSH_CONNECTION)

      expect(provisioned.ok).toBe(true)
      await vi.waitFor(() =>
        expect(configureCalls()).toEqual([
          {
            environmentId: 'ssh-env-1',
            method: 'desktop.configure',
            params: { host: '127.0.0.1', port: 5901, password: 'abc12345' }
          }
        ])
      )
    })

    it('a refused configure still leaves provisioning successful', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      desktopEnv.configure = () => ({
        id: 'r',
        ok: false,
        error: { code: 'desktop_agent_not_allowed', message: 'refused' }
      })
      connectRuntimeOwnedSshTargetMock.mockResolvedValueOnce({
        targetId: 'runtime-ssh-desktop',
        environmentId: 'ssh-env-1',
        target: { id: 'runtime-ssh-desktop', label: 'Sandbox', host: 'h', port: 22, username: 'r' }
      })
      try {
        const { provisioned } = await provisionWithDesktop(SSH_CONNECTION)

        expect(provisioned).toMatchObject({ ok: true, connectionType: 'ssh' })
        await vi.waitFor(() => expect(configureCalls()).toHaveLength(1))
        expect(desktopEnv.streams).toHaveLength(0)
      } finally {
        warn.mockRestore()
      }
    })

    it('attaching a workspace starts copying its recordings', async () => {
      connectRuntimeOwnedSshTargetMock.mockResolvedValueOnce({
        targetId: 'runtime-ssh-desktop',
        environmentId: 'ssh-env-1',
        target: { id: 'runtime-ssh-desktop', label: 'Sandbox', host: 'h', port: 22, username: 'r' }
      })
      const { provisioned, userDataPath } = await provisionWithDesktop(SSH_CONNECTION)
      const recording = desktopEnv.finishRecording('0123456789abcdef', 1_000)
      const workspaceId = 'repo-1::/workspace/repo'

      await handlers.get('ephemeralVm:attachWorkspace')?.(
        null,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases IPC argument types; this is the attach handler's.
        { runtimeId: provisioned.runtime.id, workspaceId } as never
      )
      await vi.waitFor(() => expect(desktopEnv.streams).toHaveLength(1))
      desktopEnv.emit(desktopEnv.streams[0], { type: 'ready', subscriptionId: 'desktop-events:1' })

      const key = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32)
      await vi.waitFor(() =>
        expect(
          existsSync(join(userDataPath, 'desktop-recordings', key, `rec-${recording.id}.mp4`))
        ).toBe(true)
      )
      expect(
        desktopEnv.calls.find((call) => call.method === 'files.resolveTerminalPath')?.params
      ).toEqual({ worktree: `id:${workspaceId}`, pathText: recording.path })
    })

    it('removing the workspace stops its recordings sync', async () => {
      connectRuntimeOwnedSshTargetMock.mockResolvedValueOnce({
        targetId: 'runtime-ssh-desktop',
        environmentId: 'ssh-env-1',
        target: { id: 'runtime-ssh-desktop', label: 'Sandbox', host: 'h', port: 22, username: 'r' }
      })
      const { provisioned } = await provisionWithDesktop(SSH_CONNECTION)
      await handlers.get('ephemeralVm:attachWorkspace')?.(
        null,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases IPC argument types; this is the attach handler's.
        { runtimeId: provisioned.runtime.id, workspaceId: 'repo-1::/workspace/repo' } as never
      )
      await vi.waitFor(() => expect(desktopEnv.streams).toHaveLength(1))

      const ack = await removalAck(provisioned.runtime, 'repo-1::/workspace/repo')
      await handlers.get('ephemeralVm:cleanup')?.(
        null,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases IPC argument types; this is the cleanup handler's.
        { runtimeId: provisioned.runtime.id, ack } as never
      )

      expect(desktopEnv.closedStreams).toBe(1)
    })

    describe('the destroy needs the removal check acknowledgement', () => {
      const WORKSPACE = 'repo-1::/workspace/repo'
      type Record = { id: string; status: string; runtimeEnvironmentId?: string }

      async function provisionAttached(options: { destroyExitCode?: number } = {}) {
        connectRuntimeOwnedSshTargetMock.mockResolvedValueOnce({
          targetId: 'runtime-ssh-desktop',
          environmentId: 'ssh-env-1',
          target: {
            id: 'runtime-ssh-desktop',
            label: 'Sandbox',
            host: 'h',
            port: 22,
            username: 'r'
          }
        })
        const provisioned = await provisionWithDesktop(SSH_CONNECTION, options)
        await handlers.get('ephemeralVm:attachWorkspace')?.(
          null,
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases IPC argument types; this is the attach handler's.
          { runtimeId: provisioned.provisioned.runtime.id, workspaceId: WORKSPACE } as never
        )
        await vi.waitFor(() => expect(desktopEnv.streams).toHaveLength(1))
        return provisioned
      }

      function cleanup(runtimeId: string, ack: string): Promise<unknown> {
        return invokeHandler('ephemeralVm:cleanup', { runtimeId, ack })
      }

      async function statusOf(runtimeId: string): Promise<string | undefined> {
        const runtimes = await invokeHandler<Record[]>('ephemeralVm:listRuntimes', undefined)
        return runtimes.find((runtime) => runtime.id === runtimeId)?.status
      }

      it('refuses without an ack or with an expired one, and proceeds with a valid one', async () => {
        const { provisioned } = await provisionAttached()
        const runtimeId = provisioned.runtime.id
        await expect(cleanup(runtimeId, '')).rejects.toThrow('not confirmed')

        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          const expired = await removalAck(provisioned.runtime, WORKSPACE)
          vi.setSystemTime(Date.now() + 2 * 60_000 + 1)
          await expect(cleanup(runtimeId, expired)).rejects.toThrow('not confirmed')
        } finally {
          vi.useRealTimers()
        }
        expect(await statusOf(runtimeId)).toBe('running')

        await expect(
          cleanup(runtimeId, await removalAck(provisioned.runtime, WORKSPACE))
        ).resolves.toMatchObject({
          status: 'cleaned'
        })
      })

      it('a cancelled review revokes its ack, so a retry needs a new decision', async () => {
        const { provisioned } = await provisionAttached()
        const checked = await invokeHandler<{ status: string; ack: string }>(
          'ephemeralVm:removalPreflight',
          { runtimeId: provisioned.runtime.id }
        )
        expect(checked.status).toBe('unchecked')
        // Undecided: the answer alone authorizes nothing.
        await expect(cleanup(provisioned.runtime.id, checked.ack)).rejects.toThrow('not confirmed')
        await invokeHandler('ephemeralVm:revokeRemoval', { ack: checked.ack })
        await expect(
          invokeHandler('ephemeralVm:confirmRemoval', { ack: checked.ack })
        ).resolves.toBe(false)
        await expect(cleanup(provisioned.runtime.id, checked.ack)).rejects.toThrow('not confirmed')
        expect(await statusOf(provisioned.runtime.id)).toBe('running')
      })

      it('a failed destroy restarts the sync and its ack cannot be reused', async () => {
        const { provisioned } = await provisionAttached({ destroyExitCode: 1 })
        const runtimeId = provisioned.runtime.id
        const ack = await removalAck(provisioned.runtime, WORKSPACE)

        await expect(cleanup(runtimeId, ack)).resolves.toMatchObject({ status: 'cleanup_failed' })
        // The environment is still up, so its recordings keep being copied.
        await vi.waitFor(() => expect(desktopEnv.streams).toHaveLength(2))
        await expect(cleanup(runtimeId, ack)).rejects.toThrow('not confirmed')
      })

      it('copies the recordings, then destroys with the ack the copy returned', async () => {
        const { provisioned, userDataPath } = await provisionAttached()
        const recording = desktopEnv.finishRecording('0123456789abcdef', 1_000)
        const target = { hostId: 'runtime:ssh-env-1', workspaceId: WORKSPACE }
        const checked = await invokeHandler<{ recordingsNotCopied: { id: string }[] }>(
          'ephemeralVm:removalPreflight',
          target
        )
        expect(checked.recordingsNotCopied.map((pending) => pending.id)).toEqual([recording.id])

        const copied = await invokeHandler<{ ok: boolean; ack?: string }>(
          'ephemeralVm:copyRecordingsBeforeRemoval',
          target
        )
        expect(copied).toMatchObject({ ok: true, copied: 1 })
        const key = createHash('sha256').update(WORKSPACE).digest('hex').slice(0, 32)
        expect(
          existsSync(join(userDataPath, 'desktop-recordings', key, `rec-${recording.id}.mp4`))
        ).toBe(true)
        await expect(cleanup(provisioned.runtime.id, copied.ack ?? '')).resolves.toMatchObject({
          status: 'cleaned'
        })
      })

      it('a failed copy hands out no ack, so the environment is never destroyed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
          const { provisioned } = await provisionAttached()
          desktopEnv.finishRecording('0123456789abcdef', 1_000)
          desktopEnv.failReads = 1_000
          const target = { hostId: 'runtime:ssh-env-1', workspaceId: WORKSPACE }
          const copied = await invokeHandler<{ ok: boolean; ack?: string }>(
            'ephemeralVm:copyRecordingsBeforeRemoval',
            target
          )
          expect(copied).toEqual({ ok: false, reason: 'copy_failed' })
          await expect(cleanup(provisioned.runtime.id, copied.ack ?? '')).rejects.toThrow(
            'not confirmed'
          )
          expect(await statusOf(provisioned.runtime.id)).toBe('running')
        } finally {
          warn.mockRestore()
        }
      })
    })
  })
})
