import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import {
  desktopEnvironmentFake as env,
  FAKE_CHECKOUT
} from './desktop-environment-fake.test-support'

const paths = vi.hoisted(() => ({ userData: '' }))
// When set, the next `lstat` or `mkdir` reports it was reached, waits for `open`, then reports it finished.
type FsHold = { open: Promise<void>; reached: () => void; finished: () => void }
type FsGates = { lstat: FsHold | null; mkdir: FsHold | null }
const fsGates = vi.hoisted((): FsGates => ({ lstat: null, mkdir: null }))

vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', async () =>
  (await import('./desktop-environment-fake.test-support')).fakeTransportRoutingModule()
)

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  /** Runs `run` once the hold for `name`, if any, opens; the hold covers only one call. */
  async function afterGate<T>(name: keyof FsGates, run: () => Promise<T>): Promise<T> {
    const hold = fsGates[name]
    fsGates[name] = null
    if (!hold) {
      return run()
    }
    hold.reached()
    await hold.open
    try {
      return await run()
    } finally {
      hold.finished()
    }
  }
  const lstat = (...args: Parameters<typeof actual.lstat>) =>
    afterGate('lstat', () => actual.lstat(...args))
  const mkdir = (...args: Parameters<typeof actual.mkdir>) =>
    afterGate('mkdir', () => actual.mkdir(...args))
  return { ...actual, lstat, mkdir, default: { ...actual, lstat, mkdir } }
})

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

/**
 * Waits for file I/O and promises without moving the fake clock, unlike `vi.waitFor`. It counts no
 * turns: real disk I/O under load takes any number of them, so only the test timeout bounds it.
 */
async function settleUntil(condition: () => boolean): Promise<void> {
  while (!condition()) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

/** Holds the next `name` call: `reached` once it is called, `finished` once the real call returns. */
function holdNextFsCall(name: keyof FsGates): {
  reached: Promise<void>
  finished: Promise<void>
  release: () => void
} {
  let release = (): void => {}
  let reached = (): void => {}
  let finished = (): void => {}
  const hold: FsHold = {
    open: new Promise<void>((resolve) => (release = resolve)),
    reached: () => reached(),
    finished: () => finished()
  }
  fsGates[name] = hold
  return {
    reached: new Promise<void>((resolve) => (reached = resolve)),
    finished: new Promise<void>((resolve) => (finished = resolve)),
    release
  }
}

/** Lets pending file I/O and promises finish, so an assertion that nothing happened means it. */
async function settle(turns = 50): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
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
    fsGates.lstat = null
    fsGates.mkdir = null
    env.reset()
    await removeTempDirs([paths.userData])
  })

  /** Starts the sync; its first pass runs on start, and `ready` only asks for another. */
  async function connected(): Promise<void> {
    stops.push(syncEnvironmentRecordings('env-1', WORKSPACE_ID))
    await settleUntil(() => env.streams.length === 1 && listCalls() === 1)
    env.emit(env.streams[0], { type: 'ready', subscriptionId: 'desktop-events:1' })
    await settle()
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

  /** Holds list answers until the returned release is called. */
  function holdLists(): () => void {
    let release = (): void => {}
    env.listGate = new Promise<void>((resolve) => {
      release = () => {
        env.listGate = null
        resolve()
      }
    })
    return release
  }

  /** Asserts the next pass comes exactly `delayMs` after now, not a millisecond earlier. */
  async function expectNextPassAfter(delayMs: number): Promise<void> {
    const before = listCalls()
    await vi.advanceTimersByTimeAsync(delayMs - 1)
    await settle()
    expect(listCalls()).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(listCalls()).toBe(before + 1)
  }

  it('the first pass runs on start, before the stream is ready', async () => {
    const recording = env.finishRecording('a1a1a1a1a1a1a1a1', 1_000)
    stops.push(syncEnvironmentRecordings('env-1', WORKSPACE_ID))

    await settleUntil(() => localRecordingPath(recording.id) !== null)
    expect(listCalls()).toBe(1)
  })

  it('a recording finishing during a failing list waits for the retry, then copies once', async () => {
    const release = holdLists()
    env.failLists = 1
    stops.push(syncEnvironmentRecordings('env-1', WORKSPACE_ID))
    await settleUntil(() => env.streams.length === 1 && listCalls() === 1)
    // A recording finishes while the failing list is still out.
    const recording = env.finishRecording('abababababababab', 1_000)
    env.emit(env.streams[0], { type: 'recording-finished', ...recording })
    release()

    await expectNextPassAfter(5_000)
    await settleUntil(() => localRecordingPath(recording.id) !== null)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(listCalls()).toBe(2)
  })

  it('live events during a pending backoff do not start a pass before the timer fires', async () => {
    env.failLists = 1
    await connected()
    await settleUntil(() => warn.mock.calls.length === 1)
    for (const id of ['c1c1c1c1c1c1c1c1', 'c2c2c2c2c2c2c2c2', 'c3c3c3c3c3c3c3c3']) {
      const recording = env.finishRecording(id, 10)
      env.emit(env.streams[0], { type: 'recording-finished', ...recording })
      env.emit(env.streams[0], { type: 'ready', subscriptionId: 'desktop-events:1' })
      await vi.advanceTimersByTimeAsync(1_000)
      await settle()
    }
    expect(listCalls()).toBe(1)

    await expectNextPassAfter(2_000)
    await settleUntil(() => localRecordingPath('c3c3c3c3c3c3c3c3') !== null)
    expect(listCalls()).toBe(2)
  })

  it('stopping while checking for a local copy creates no directory and indexes nothing', async () => {
    const lstatHold = holdNextFsCall('lstat')
    const recording = env.finishRecording('d1d1d1d1d1d1d1d1', 10)
    const stop = syncEnvironmentRecordings('env-1', WORKSPACE_ID)
    await lstatHold.reached
    stop()
    lstatHold.release()
    await lstatHold.finished
    await settle()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(existsSync(workspaceDir())).toBe(false)
    expect(localRecordingPath(recording.id)).toBeNull()
    expect(env.methods()).not.toContain('files.resolveTerminalPath')
    expect(listCalls()).toBe(1)
  })

  it('stopping while creating the directory copies and indexes nothing', async () => {
    const mkdirHold = holdNextFsCall('mkdir')
    const recording = env.finishRecording('d2d2d2d2d2d2d2d2', 10)
    const stop = syncEnvironmentRecordings('env-1', WORKSPACE_ID)
    await mkdirHold.reached
    stop()
    mkdirHold.release()
    await mkdirHold.finished
    await settle()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(localRecordingPath(recording.id)).toBeNull()
    expect(env.methods()).not.toContain('files.resolveTerminalPath')
    expect(listCalls()).toBe(1)
  })

  it('a live recording finishing during a list and failing to copy keeps the backoff growing', async () => {
    const release = holdLists()
    stops.push(syncEnvironmentRecordings('env-1', WORKSPACE_ID))
    await settleUntil(() => env.streams.length === 1 && listCalls() === 1)
    const late = env.finishRecording('bcbcbcbcbcbcbcbc', 1_000)
    env.failReadsFor.set(late.path, 100)
    env.emit(env.streams[0], { type: 'recording-finished', ...late })
    release()
    // The first list did not hold it; the pass the event asked for runs next and fails.
    await settleUntil(() => listCalls() === 2 && warn.mock.calls.length === 1)

    await expectNextPassAfter(5_000)
    await settleUntil(() => warn.mock.calls.length === 2)
    await expectNextPassAfter(10_000)
    await settleUntil(() => warn.mock.calls.length === 3)
    await expectNextPassAfter(20_000)
  })

  it('a full successful pass resets the backoff', async () => {
    env.failLists = 2
    await connected()
    await expectNextPassAfter(5_000)
    await expectNextPassAfter(10_000)
    // The third pass succeeds; a later failure starts again from 5 s.
    await settle()
    env.failLists = 1
    const recording = env.finishRecording('cdcdcdcdcdcdcdcd', 10)
    env.emit(env.streams[0], { type: 'recording-finished', ...recording })
    await settleUntil(() => listCalls() === 4)

    await expectNextPassAfter(5_000)
    await settleUntil(() => localRecordingPath(recording.id) !== null)
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
