import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import {
  desktopEnvironmentFake as env,
  FAKE_CHECKOUT
} from './desktop-environment-fake.test-support'

const paths = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', async () =>
  (await import('./desktop-environment-fake.test-support')).fakeTransportRoutingModule()
)

import { syncEnvironmentRecordings } from './desktop-recording-sync'
import { indexLocalRecordings, localRecordingPath } from './desktop-recording-index'

// The shape the attach path stores: repo id, `::`, then the checkout path.
const WORKSPACE_ID = 'repo-1::/workspace/repo'

function workspaceDir(): string {
  // The id holds `::` and a path, so its directory is named by a sha256 prefix instead.
  const key = createHash('sha256').update(WORKSPACE_ID).digest('hex').slice(0, 32)
  return join(paths.userData, 'desktop-recordings', key)
}

function copiedPath(id: string): string {
  return join(workspaceDir(), `rec-${id}.mp4`)
}

/** Waits for file I/O and promises without moving the fake clock, unlike `vi.waitFor`. */
async function settleUntil(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 2_000 && !condition(); turn++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  expect(condition()).toBe(true)
}

function listCalls(): number {
  return env.methods().filter((method) => method === 'desktop.recordings.list').length
}

describe('syncEnvironmentRecordings', () => {
  let warn: ReturnType<typeof vi.spyOn>
  const stops: (() => void)[] = []

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    paths.userData = mkdtempSync(join(tmpdir(), 'orca-desktop-sync-'))
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    for (const stop of stops.splice(0)) {
      stop()
    }
    vi.useRealTimers()
    warn.mockRestore()
    env.reset()
    await removeTempDirs([paths.userData])
  })

  async function connected(): Promise<void> {
    stops.push(syncEnvironmentRecordings('env-1', WORKSPACE_ID))
    await vi.waitFor(() => expect(env.streams).toHaveLength(1))
    env.emit(env.streams[0], { type: 'ready', subscriptionId: 'desktop-events:1' })
    await vi.waitFor(() => expect(listCalls()).toBe(1))
  }

  it('a finished recording is copied to the Mac', async () => {
    await connected()
    // Larger than one host chunk read, so the copy pages through the file.
    const recording = env.finishRecording('0123456789abcdef', 300_000)
    env.emit(env.streams[0], { type: 'recording-finished', ...recording })

    await vi.waitFor(() =>
      expect(localRecordingPath('0123456789abcdef')).toBe(copiedPath('0123456789abcdef'))
    )
    expect(
      readFileSync(copiedPath('0123456789abcdef')).equals(env.files.get(recording.path)!)
    ).toBe(true)
    expect(readdirSync(workspaceDir())).toEqual(['rec-0123456789abcdef.mp4'])
    // The RPC selector keeps the workspace's own id.
    expect(env.calls.find((call) => call.method === 'files.resolveTerminalPath')?.params).toEqual({
      worktree: 'id:repo-1::/workspace/repo',
      pathText: recording.path
    })
    if (process.platform !== 'win32') {
      expect(statSync(copiedPath('0123456789abcdef')).mode & 0o777).toBe(0o600)
      expect(statSync(workspaceDir()).mode & 0o777).toBe(0o700)
    }
  })

  it('a recording inside the workspace checkout is copied', async () => {
    await connected()
    const recording = env.finishRecording('1111111111111111', 1_000, `${FAKE_CHECKOUT}/out`)
    env.emit(env.streams[0], { type: 'recording-finished', ...recording })

    await vi.waitFor(() => expect(localRecordingPath('1111111111111111')).not.toBeNull())
    expect(statSync(copiedPath('1111111111111111')).size).toBe(1_000)
    expect(env.methods()).toContain('files.readChunk')
  })

  it('recordings missed while disconnected are copied on connect', async () => {
    const before = env.finishRecording('aaaaaaaaaaaaaaaa', 1_000)
    mkdirSync(workspaceDir(), { recursive: true })
    writeFileSync(copiedPath(before.id), env.files.get(before.path)!)
    await connected()

    env.streams[0]?.onClose()
    env.finishRecording('bbbbbbbbbbbbbbbb', 2_000)
    env.finishRecording('cccccccccccccccc', 3_000)
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(env.streams).toHaveLength(2))
    env.emit(env.streams[1], { type: 'ready', subscriptionId: 'desktop-events:2' })

    await vi.waitFor(() => {
      expect(localRecordingPath('bbbbbbbbbbbbbbbb')).toBe(copiedPath('bbbbbbbbbbbbbbbb'))
      expect(localRecordingPath('cccccccccccccccc')).toBe(copiedPath('cccccccccccccccc'))
    })
    // A recording already on the Mac is not read again.
    expect(
      env.calls.filter(
        (call) =>
          call.method === 'files.resolveTerminalPath' && call.params.pathText === before.path
      )
    ).toEqual([])
  })

  it('a failed list is retried on a backoff while the stream stays up', async () => {
    env.finishRecording('dddddddddddddddd', 1_000)
    env.failLists = 2
    await connected()

    await vi.advanceTimersByTimeAsync(4_999)
    expect(listCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(listCalls()).toBe(2)
    // The second failure doubles the delay to 10 s.
    await vi.advanceTimersByTimeAsync(9_999)
    expect(listCalls()).toBe(2)
    await vi.advanceTimersByTimeAsync(1)

    await vi.waitFor(() => expect(localRecordingPath('dddddddddddddddd')).not.toBeNull())
    expect(env.streams).toHaveLength(1)
  })

  it('a failed copy leaves no file and is retried on a backoff', async () => {
    const recording = env.finishRecording('eeeeeeeeeeeeeeee', 1_000)
    env.failReads = 1
    await connected()
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(localRecordingPath(recording.id)).toBeNull()
    expect(readdirSync(workspaceDir())).toEqual([])

    await vi.advanceTimersByTimeAsync(5_000)

    await vi.waitFor(() => expect(localRecordingPath(recording.id)).toBe(copiedPath(recording.id)))
    expect(listCalls()).toBe(2)
  })

  it('a copy finishing late does not reset the backoff of a later failing retry', async () => {
    const first = env.finishRecording('aaaaaaaaaaaaaaaa', 1_000)
    const slow = env.finishRecording('bbbbbbbbbbbbbbbb', 1_000)
    env.failReadsFor.set(first.path, 2)
    let releaseSlow = (): void => {}
    env.readGates.set(
      slow.path,
      new Promise<void>((resolve) => {
        releaseSlow = resolve
      })
    )
    await connected()
    await settleUntil(() => warn.mock.calls.length === 1)

    // The retry starts while the first reconcile still waits on the slow copy.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(listCalls()).toBe(2)
    releaseSlow()
    await settleUntil(() => warn.mock.calls.length === 2)
    expect(localRecordingPath(slow.id)).toBe(copiedPath(slow.id))

    // Two failures in a row: the next retry waits 10 s, not 5 s.
    await vi.advanceTimersByTimeAsync(9_999)
    expect(listCalls()).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(listCalls()).toBe(3)
  })

  it('stopping cancels a pending retry', async () => {
    env.failLists = 1
    await connected()
    stops.splice(0).forEach((stop) => stop())

    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(listCalls()).toBe(1)
    expect(env.streams).toHaveLength(1)
  })

  it('finds recordings an earlier session copied', async () => {
    mkdirSync(workspaceDir(), { recursive: true })
    writeFileSync(copiedPath('ffffffffffffffff'), 'mp4')
    writeFileSync(join(workspaceDir(), '.rec-1234.partial'), '')

    await indexLocalRecordings()

    expect(localRecordingPath('ffffffffffffffff')).toBe(copiedPath('ffffffffffffffff'))
    expect(localRecordingPath('../../etc/passwd')).toBeNull()
  })
})
