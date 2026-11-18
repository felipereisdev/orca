import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import { parseEphemeralVmRecipeResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { encodePairingOffer } from '../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'

type Recording = { id: string; path: string; bytes: number; createdAt: string }
type StreamCallbacks = {
  onEvent: (payload: { type: string; response?: unknown }) => void
  onClose: () => void
}

type FakeEnvironment = {
  userDataPath: string
  files: Map<string, Buffer>
  recordings: Recording[]
  failReads: number
  configure: (params: unknown) => unknown
  streams: StreamCallbacks[]
  calls: { environmentId: string; method: string; params: Record<string, unknown> }[]
}

const env = vi.hoisted((): FakeEnvironment => ({
  userDataPath: '',
  files: new Map(),
  recordings: [],
  failReads: 0,
  configure: () => ({ ok: true, result: { state: 'ready' } }),
  streams: [],
  calls: []
}))

vi.mock('electron', () => ({ app: { getPath: () => env.userDataPath } }))

vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', () => {
  const ok = (result: unknown) => ({ id: 'r', ok: true, result, _meta: { runtimeId: 'vm' } })
  return {
    callRuntimeEnvironment: vi.fn(
      async (_root: string, environmentId: string, method: string, params: never) => {
        const args: Record<string, unknown> = params ?? {}
        env.calls.push({ environmentId, method, params: args })
        switch (method) {
          case 'desktop.configure':
            return env.configure(args)
          case 'desktop.recordings.list':
            return ok({ recordings: env.recordings })
          case 'files.resolveTerminalPath': {
            const path = String(args.pathText)
            return ok({
              openTarget: {
                kind: 'absolute-file',
                absolutePath: path,
                grantId: `grant:${path}`,
                byteLength: env.files.get(path)?.length ?? 0
              }
            })
          }
          case 'files.readTerminalArtifactChunk': {
            if (env.failReads > 0) {
              env.failReads -= 1
              return { id: 'r', ok: false, error: { code: 'io', message: 'connection reset' } }
            }
            const file = env.files.get(String(args.absolutePath)) ?? Buffer.alloc(0)
            const offset = Number(args.offset)
            const chunk = file.subarray(offset, offset + Number(args.length))
            return ok({
              contentBase64: chunk.toString('base64'),
              bytesRead: chunk.length,
              eof: offset + chunk.length >= file.length
            })
          }
          default:
            throw new Error(`unexpected method ${method}`)
        }
      }
    ),
    subscribeRuntimeEnvironment: vi.fn(
      async (
        _root: string,
        _environmentId: string,
        _method: string,
        _params: unknown,
        _timeout: unknown,
        callbacks: StreamCallbacks
      ) => {
        env.streams.push(callbacks)
        return { close: () => callbacks.onClose() }
      }
    )
  }
})

import { configureEnvironmentDesktop, handOffRecipeEnvironmentDesktop } from './desktop-configure'
import { syncEnvironmentRecordings } from './desktop-recording-sync'
import { indexLocalRecordings, localRecordingPath } from './desktop-recording-index'

const PASSWORD = 'abc12345'
const TOKEN = 'launcher-token-0123456789abcdef0123'
const DESKTOP = {
  type: 'vnc' as const,
  host: '127.0.0.1',
  port: 5901,
  password: PASSWORD,
  launcher: { port: 7070, token: TOKEN }
}
const EXPERIMENT_ON = { getSettings: () => ({ experimentalEphemeralVms: true }) }

function recipeResult(desktop?: unknown) {
  const parsed = parseEphemeralVmRecipeResult(
    JSON.stringify({
      schemaVersion: 1,
      connection: { type: 'orca-server', pairingCode: PAIRING_CODE, projectRoot: '/w' },
      ...(desktop ? { desktop } : {})
    })
  )
  if (!parsed.ok) {
    throw new Error('fixture recipe result did not parse')
  }
  return parsed.result
}

function finishRecording(id: string, bytes: number): Recording {
  const path = `/home/agent/.orca/desktop-recordings/rec-${id}.mp4`
  env.files.set(path, Buffer.alloc(bytes, id.charCodeAt(0)))
  const recording = { id, path, bytes, createdAt: '2026-11-18T12:00:00.000Z' }
  env.recordings.push(recording)
  return recording
}

function emit(stream: StreamCallbacks | undefined, result: unknown): void {
  stream?.onEvent({ type: 'response', response: { id: 's', ok: true, result, _meta: {} } })
}

function copiedPath(id: string): string {
  return join(env.userDataPath, 'desktop-recordings', 'ws-1', `rec-${id}.mp4`)
}

const PAIRING_CODE = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'wss://vm.example.com',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key'
})

describe('host hand-off of the recipe desktop', () => {
  let warn: ReturnType<typeof vi.spyOn>
  const stops: (() => void)[] = []

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    env.userDataPath = mkdtempSync(join(tmpdir(), 'orca-desktop-host-'))
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    for (const stop of stops.splice(0)) {
      stop()
    }
    vi.useRealTimers()
    warn.mockRestore()
    env.files.clear()
    env.recordings = []
    env.failReads = 0
    env.streams = []
    env.calls = []
    env.configure = () => ({ ok: true, result: { state: 'ready' } })
    await removeTempDirs([env.userDataPath])
  })

  it('calls desktop.configure with the recipe desktop after provisioning', async () => {
    await handOffRecipeEnvironmentDesktop(EXPERIMENT_ON, {
      runtimeEnvironmentId: 'env-1',
      recipeResult: recipeResult(DESKTOP)
    })

    expect(env.calls).toEqual([
      {
        environmentId: 'env-1',
        method: 'desktop.configure',
        params: {
          host: '127.0.0.1',
          port: 5901,
          password: PASSWORD,
          launcher: { port: 7070, token: TOKEN }
        }
      }
    ])
  })

  it('skips when the recipe has no desktop', async () => {
    expect(await configureEnvironmentDesktop('env-1', null)).toBe('skipped')
    await handOffRecipeEnvironmentDesktop(EXPERIMENT_ON, {
      runtimeEnvironmentId: 'env-1',
      workspaceId: 'ws-1',
      recipeResult: recipeResult()
    })
    // The experiment gate is the host's: with it off a desktop recipe is not configured either.
    await handOffRecipeEnvironmentDesktop(
      { getSettings: () => ({ experimentalEphemeralVms: false }) },
      { runtimeEnvironmentId: 'env-1', workspaceId: 'ws-1', recipeResult: recipeResult(DESKTOP) }
    )

    expect(env.calls).toEqual([])
    expect(env.streams).toHaveLength(0)
  })

  it('a failing configure does not fail provisioning and does not log the password', async () => {
    env.configure = () => {
      throw new Error(`refused {"password":"${PASSWORD}"} launcher ${TOKEN} with ${PASSWORD}`)
    }
    expect(await configureEnvironmentDesktop('env-1', DESKTOP)).toBe('failed')
    env.configure = () => ({
      id: 'r',
      ok: false,
      error: { code: 'desktop_unavailable', message: `bad password ${PASSWORD}` }
    })
    await expect(
      handOffRecipeEnvironmentDesktop(EXPERIMENT_ON, {
        runtimeEnvironmentId: 'env-1',
        workspaceId: 'ws-1',
        recipeResult: recipeResult(DESKTOP)
      })
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(2)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(TOKEN)
    // No controller was bound, so the recording sync does not subscribe.
    expect(env.streams).toHaveLength(0)
  })

  it('a finished recording is copied to the Mac', async () => {
    stops.push(syncEnvironmentRecordings('env-1', 'ws-1'))
    await vi.waitFor(() => expect(env.streams).toHaveLength(1))
    emit(env.streams[0], { type: 'ready', subscriptionId: 'desktop-events:1' })
    // Larger than one host chunk read, so the copy pages through the file.
    const recording = finishRecording('0123456789abcdef', 300_000)
    emit(env.streams[0], { type: 'recording-finished', ...recording })

    await vi.waitFor(() =>
      expect(localRecordingPath('0123456789abcdef')).toBe(copiedPath('0123456789abcdef'))
    )
    expect(
      readFileSync(copiedPath('0123456789abcdef')).equals(env.files.get(recording.path)!)
    ).toBe(true)
    expect(readdirSync(join(env.userDataPath, 'desktop-recordings', 'ws-1'))).toEqual([
      'rec-0123456789abcdef.mp4'
    ])
    if (process.platform !== 'win32') {
      expect(statSync(copiedPath('0123456789abcdef')).mode & 0o777).toBe(0o600)
      expect(statSync(join(env.userDataPath, 'desktop-recordings', 'ws-1')).mode & 0o777).toBe(
        0o700
      )
    }
  })

  it('recordings missed while disconnected are copied on connect', async () => {
    const before = finishRecording('aaaaaaaaaaaaaaaa', 1_000)
    const dir = join(env.userDataPath, 'desktop-recordings', 'ws-1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(copiedPath(before.id), env.files.get(before.path)!)
    stops.push(syncEnvironmentRecordings('env-1', 'ws-1'))
    await vi.waitFor(() => expect(env.streams).toHaveLength(1))
    emit(env.streams[0], { type: 'ready', subscriptionId: 'desktop-events:1' })
    await vi.waitFor(() =>
      expect(env.calls.map((call) => call.method)).toContain('desktop.recordings.list')
    )

    env.streams[0]?.onClose()
    finishRecording('bbbbbbbbbbbbbbbb', 2_000)
    finishRecording('cccccccccccccccc', 3_000)
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(env.streams).toHaveLength(2))
    emit(env.streams[1], { type: 'ready', subscriptionId: 'desktop-events:2' })

    await vi.waitFor(() => {
      expect(localRecordingPath('bbbbbbbbbbbbbbbb')).toBe(copiedPath('bbbbbbbbbbbbbbbb'))
      expect(localRecordingPath('cccccccccccccccc')).toBe(copiedPath('cccccccccccccccc'))
    })
    expect(statSync(copiedPath('cccccccccccccccc')).size).toBe(3_000)
    // A recording already on the Mac is not read again.
    expect(
      env.calls.filter(
        (call) =>
          call.method === 'files.resolveTerminalPath' && call.params.pathText === before.path
      )
    ).toEqual([])
  })

  it('finds recordings an earlier session copied', async () => {
    mkdirSync(join(env.userDataPath, 'desktop-recordings', 'ws-1'), { recursive: true })
    writeFileSync(copiedPath('ffffffffffffffff'), 'mp4')
    writeFileSync(join(env.userDataPath, 'desktop-recordings', 'ws-1', '.rec-1234.partial'), '')

    await indexLocalRecordings()

    expect(localRecordingPath('ffffffffffffffff')).toBe(copiedPath('ffffffffffffffff'))
    expect(localRecordingPath('../../etc/passwd')).toBeNull()
  })

  it('a failed copy leaves no file and is retried on the next reconcile', async () => {
    const recording = finishRecording('dddddddddddddddd', 1_000)
    env.failReads = 1
    stops.push(syncEnvironmentRecordings('env-1', 'ws-1'))
    await vi.waitFor(() => expect(env.streams).toHaveLength(1))
    emit(env.streams[0], { type: 'ready', subscriptionId: 'desktop-events:1' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(localRecordingPath(recording.id)).toBeNull()
    expect(readdirSync(join(env.userDataPath, 'desktop-recordings', 'ws-1'))).toEqual([])

    emit(env.streams[0], { type: 'recording-finished', ...finishRecording('eeeeeeeeeeeeeeee', 10) })

    await vi.waitFor(() => {
      expect(localRecordingPath(recording.id)).toBe(copiedPath(recording.id))
      expect(localRecordingPath('eeeeeeeeeeeeeeee')).toBe(copiedPath('eeeeeeeeeeeeeeee'))
    })
  })
})
