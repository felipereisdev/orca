import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopFrame } from './desktop-control-connection'
import { findExecutableOnPath, findFfmpeg, spawnFfmpeg } from './desktop-ffmpeg'
import { DesktopRecorder, type DesktopRecordingResult } from './desktop-recorder'
import { createFakeFfmpeg, type FakeFfmpegOptions } from './testing/fake-ffmpeg'

const encoderAvailable =
  process.platform !== 'win32' &&
  (await findFfmpeg()) !== null &&
  (await findExecutableOnPath('ffprobe')) !== null

type Pixel = [number, number, number, number]

function frame(width: number, height: number, pixel: Pixel): DesktopFrame {
  const pixels = Buffer.alloc(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set(pixel, offset)
  }
  return { width, height, rgba: () => Buffer.from(pixels) }
}

function noise(width: number, height: number): DesktopFrame {
  const pixels = randomBytes(width * height * 4)
  return { width, height, rgba: () => Buffer.from(pixels) }
}

function frameSource(initial: DesktopFrame) {
  let current = initial
  const listeners = new Set<(frame: DesktopFrame) => void>()
  return {
    onFrame: (cb: (frame: DesktopFrame) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    currentFrame: () => current,
    publish: (next: DesktopFrame) => {
      current = next
      for (const listener of listeners) {
        listener(next)
      }
    }
  }
}

function probe(path: string, entries: string): string[] {
  return execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    entries,
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path
  ])
    .toString()
    .trim()
    .split('\n')
}

const RED: Pixel = [255, 0, 0, 255]
const BLUE: Pixel = [0, 0, 255, 255]
const BLACK: Pixel = [0, 0, 0, 255]
const KiB = 1024
const MiB = 1024 * KiB
const LIMITS = { maxSeconds: 600, maxBytes: 200 * MiB }
type FakeTimer = NonNullable<Parameters<typeof vi.useFakeTimers>[0]>['toFake']
const INTERVAL_TIMERS: { toFake: FakeTimer } = { toFake: ['setInterval', 'clearInterval'] }

let dir: string

/** Finalizing awaits real file I/O, which fake timers do not advance. */
async function settled(recorder: DesktopRecorder): Promise<void> {
  await vi.waitFor(() => expect(recorder.active()).toBe(false))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-recorder-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function setup(
  opts: FakeFfmpegOptions & {
    ffmpegPath?: string | null
    first?: DesktopFrame
    now?: () => number
  } = {}
) {
  const source = frameSource(opts.first ?? frame(4, 2, RED))
  const ffmpeg = createFakeFfmpeg(opts)
  const recorder = new DesktopRecorder(source, {
    findFfmpeg: () => (opts.ffmpegPath === undefined ? '/usr/bin/ffmpeg' : opts.ffmpegPath),
    spawnFfmpeg: ffmpeg.spawn,
    now: opts.now
  })
  const finished: DesktopRecordingResult[] = []
  recorder.onFinished((result) => finished.push(result))
  return { source, ffmpeg, recorder, finished }
}

describe('DesktopRecorder', () => {
  it('writes rgba frames at 10 fps until stop', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { source, ffmpeg, recorder, finished } = setup()
    const recordingsDir = join(dir, 'recordings')

    const { id, path } = await recorder.start({ ...LIMITS, dir: recordingsDir })
    const partial = join(recordingsDir, `.rec-${id}.partial.mp4`)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(path).toBe(join(recordingsDir, `rec-${id}.mp4`))
    expect(recorder.active()).toBe(true)
    expect(ffmpeg.spawns).toEqual([
      {
        command: '/usr/bin/ffmpeg',
        // -fs: 200 MiB less 2% headroom for buffered output and the MP4 index.
        // prettier-ignore
        args: [
          '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '4x2', '-r', '10', '-i', '-',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
          '-fs', '205520896', partial
        ]
      }
    ])

    await vi.advanceTimersByTimeAsync(500)
    source.publish(frame(4, 2, BLUE))
    await vi.advanceTimersByTimeAsync(500)
    const result = await recorder.stop()
    await vi.advanceTimersByTimeAsync(1000)

    expect(ffmpeg.frames).toHaveLength(10)
    expect(ffmpeg.frames[0]).toEqual(frame(4, 2, RED).rgba())
    expect(ffmpeg.frames[9]).toEqual(frame(4, 2, BLUE).rgba())
    expect(result).toEqual({ id, path, seconds: 1, bytes: 1000, stopped: 'requested' })
    expect(finished).toEqual([result])
    expect(recorder.active()).toBe(false)
    expect(existsSync(partial)).toBe(false)
    if (process.platform !== 'win32') {
      expect(statSync(recordingsDir).mode & 0o777).toBe(0o700)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('writes the first frame before an immediate stop closes the encoder', async () => {
    const { ffmpeg, recorder } = setup()

    const { id, path } = await recorder.start({ ...LIMITS, dir })
    const result = await recorder.stop()

    expect(ffmpeg.frames).toEqual([frame(4, 2, RED).rgba()])
    expect(result).toEqual({ id, path, seconds: 0.1, bytes: 100, stopped: 'requested' })
  })

  it('stops itself at maxSeconds with stopped: limit', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const { ffmpeg, recorder, finished } = setup()

    const { id, path } = await recorder.start({ ...LIMITS, maxSeconds: 2, dir })
    await vi.advanceTimersByTimeAsync(3000)
    await settled(recorder)

    expect(ffmpeg.frames).toHaveLength(20)
    expect(finished).toEqual([{ id, path, seconds: 2, bytes: 2000, stopped: 'limit' }])
    expect(recorder.active()).toBe(false)
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_not_recording' })
  })

  it('stops at the maxSeconds deadline even when timer callbacks were skipped', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    let clock = 1_000
    const { recorder, finished } = setup({ now: () => clock })

    await recorder.start({ ...LIMITS, maxSeconds: 2, dir })
    // A blocked event loop: 2.5 s pass, but only one sampling callback runs.
    clock += 2_500
    await vi.advanceTimersByTimeAsync(100)
    await settled(recorder)

    expect(finished).toEqual([expect.objectContaining({ seconds: 0.1, stopped: 'limit' })])
  })

  it('stops itself before maxBytes so the finalized file fits', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { ffmpeg, recorder, finished } = setup({ bytesPerFrame: 64 * KiB, indexBytes: 100 * KiB })

    const { id, path } = await recorder.start({ ...LIMITS, maxBytes: MiB, dir })
    await vi.advanceTimersByTimeAsync(3000)
    await settled(recorder)

    // Stops at 1 MiB less 256 KiB headroom (12 frames), then the index lands: 868 KiB.
    expect(ffmpeg.spawns[0].args).toContain(String(768 * KiB))
    expect(ffmpeg.frames).toHaveLength(12)
    expect(finished).toEqual([{ id, path, seconds: 1.2, bytes: 868 * KiB, stopped: 'limit' }])
  })

  it('fails a recording whose finalized file outgrew maxBytes', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { recorder, finished } = setup({ bytesPerFrame: 64 * KiB, indexBytes: 400 * KiB })

    const { path } = await recorder.start({ ...LIMITS, maxBytes: MiB, dir })
    await vi.advanceTimersByTimeAsync(3000)
    await settled(recorder)

    expect(finished).toEqual([])
    expect(recorder.active()).toBe(false)
    expect(existsSync(path)).toBe(false)
    expect(await recorder.list(dir)).toEqual([])
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_recording_failed' })
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_not_recording' })
  })

  it('pads frames to the starting size after a resize', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { source, ffmpeg, recorder } = setup()

    await recorder.start({ ...LIMITS, dir })
    // Narrower and taller than the 4x2 start: columns are padded black, the extra row is cropped.
    source.publish(frame(2, 3, BLUE))
    await vi.advanceTimersByTimeAsync(100)
    await recorder.stop()

    const B = [...BLUE]
    const K = [...BLACK]
    expect([...ffmpeg.frames[0]]).toEqual([...B, ...B, ...K, ...K, ...B, ...B, ...K, ...K])
  })

  it('pads odd starting dimensions to an even canvas, as yuv420p requires', async () => {
    const { ffmpeg, recorder } = setup({ first: frame(5, 3, RED) })

    await recorder.start({ ...LIMITS, dir })
    await recorder.stop()

    expect(ffmpeg.spawns[0].args.slice(4, 6)).toEqual(['-s', '6x4'])
    const R = [...RED]
    const K = [...BLACK]
    const row = [...R, ...R, ...R, ...R, ...R, ...K]
    const blankRow = [...K, ...K, ...K, ...K, ...K, ...K]
    expect([...ffmpeg.frames[0]]).toEqual([...row, ...row, ...row, ...blankRow])
  })

  it('skips ticks while ffmpeg has not drained stdin instead of queueing frames', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { ffmpeg, recorder } = setup()

    await recorder.start({ ...LIMITS, dir })
    ffmpeg.hold()
    await vi.advanceTimersByTimeAsync(500)
    expect(ffmpeg.frames).toHaveLength(1)
    ffmpeg.release()
    await vi.advanceTimersByTimeAsync(200)
    expect(ffmpeg.frames).toHaveLength(3)
    await recorder.stop()
  })

  it('refuses a second start and a stop with nothing running', async () => {
    const { recorder } = setup()

    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_not_recording' })
    await recorder.start({ ...LIMITS, dir })
    await expect(recorder.start({ ...LIMITS, dir })).rejects.toMatchObject({
      code: 'desktop_already_recording'
    })
    await recorder.stop()
  })

  it('missing ffmpeg → desktop_recording_unavailable', async () => {
    const { recorder, ffmpeg } = setup({ ffmpegPath: null })

    await expect(recorder.start({ ...LIMITS, dir })).rejects.toMatchObject({
      code: 'desktop_recording_unavailable'
    })
    expect(ffmpeg.spawns).toEqual([])
    expect(recorder.active()).toBe(false)
  })

  it('a non-zero ffmpeg exit → desktop_recording_failed and no partial file', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { recorder, finished } = setup({ exitCode: 1 })

    const { id, path } = await recorder.start({ ...LIMITS, dir })
    await vi.advanceTimersByTimeAsync(300)

    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_recording_failed' })
    expect(finished).toEqual([])
    expect(recorder.active()).toBe(false)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(dir, `.rec-${id}.partial.mp4`))).toBe(false)
  })

  it('reports an encoder that died mid-recording on the next stop', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { ffmpeg, recorder, finished } = setup()

    await recorder.start({ ...LIMITS, dir })
    await vi.advanceTimersByTimeAsync(300)
    ffmpeg.exit(null, 'SIGSEGV')
    await settled(recorder)

    expect(finished).toEqual([])
    expect(recorder.active()).toBe(false)
    expect(await recorder.list(dir)).toEqual([])
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_recording_failed' })
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_not_recording' })
  })

  it('kills an encoder that does not finalize, and waits for it to close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const { ffmpeg, recorder, finished } = setup({ hangOnClose: true })

    await recorder.start({ ...LIMITS, dir })
    await vi.advanceTimersByTimeAsync(100)
    let settled = false
    const stopping = recorder.stop().finally(() => {
      settled = true
    })
    stopping.catch(() => {})
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ffmpeg.killed).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settled).toBe(false)
    expect(recorder.active()).toBe(true)

    ffmpeg.exit(null, 'SIGKILL')
    await expect(stopping).rejects.toMatchObject({ code: 'desktop_recording_failed' })
    expect(finished).toEqual([])
    expect(await recorder.list(dir)).toEqual([])
  })

  it('does not list a recording still being written', async () => {
    vi.useFakeTimers(INTERVAL_TIMERS)
    const { recorder } = setup()

    const { id } = await recorder.start({ ...LIMITS, dir })
    await vi.advanceTimersByTimeAsync(300)
    expect(await recorder.list(dir)).toEqual([])
    await recorder.stop()
    expect(await (await recorder.list(dir)).map((entry) => entry.id)).toEqual([id])
  })

  it('lists only recordings in the directory', async () => {
    const { recorder } = setup()
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, 'rec-notanid.mp4'), 'x')
    writeFileSync(join(dir, '.rec-0123456789abcdef.partial.mp4'), 'x')
    writeFileSync(join(dir, 'rec-0123456789abcdef.mp4'), 'abc')

    expect(await recorder.list(dir)).toEqual([
      {
        id: '0123456789abcdef',
        path: join(dir, 'rec-0123456789abcdef.mp4'),
        bytes: 3,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      }
    ])
    expect(await recorder.list(join(dir, 'missing'))).toEqual([])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'propagates a stat error other than ENOENT while listing',
    async () => {
      const { recorder } = setup()
      writeFileSync(join(dir, 'rec-0123456789abcdef.mp4'), 'abc')
      // Readable but not searchable: names list, entries cannot be stat'ed (EACCES).
      chmodSync(dir, 0o600)
      try {
        await expect(recorder.list(dir)).rejects.toMatchObject({ code: 'EACCES' })
      } finally {
        chmodSync(dir, 0o700)
      }
    }
  )

  it.skipIf(!encoderAvailable)(
    'produces a playable MP4 from odd dimensions with real ffmpeg',
    async () => {
      vi.useFakeTimers(INTERVAL_TIMERS)
      const source = frameSource(frame(5, 3, RED))
      const recorder = new DesktopRecorder(source, { spawnFfmpeg })

      const { path } = await recorder.start({ ...LIMITS, dir })
      for (let tick = 0; tick < 20; tick++) {
        await vi.advanceTimersByTimeAsync(100)
        // Real pipes drain on real I/O; give ffmpeg a turn between ticks.
        await new Promise((resolve) => setImmediate(resolve))
      }
      const result = await recorder.stop()

      expect(probe(path, 'stream=width,height')).toEqual(['6', '4'])
      expect(Number(probe(path, 'format=duration')[0])).toBeGreaterThan(0)
      expect(result.bytes).toBeGreaterThan(0)
    }
  )

  it.skipIf(!encoderAvailable)(
    'keeps a real recording within maxBytes and playable',
    async () => {
      vi.useFakeTimers(INTERVAL_TIMERS)
      const source = frameSource(noise(320, 240))
      const recorder = new DesktopRecorder(source, { spawnFfmpeg })
      const finished: DesktopRecordingResult[] = []
      recorder.onFinished((result) => finished.push(result))

      const { path } = await recorder.start({ ...LIMITS, maxBytes: MiB, dir })
      // Feeds incompressible frames until ffmpeg's -fs stop ends the recording on its own.
      await vi.waitFor(
        async () => {
          source.publish(noise(320, 240))
          await vi.advanceTimersByTimeAsync(100)
          expect(recorder.active()).toBe(false)
        },
        { timeout: 20_000, interval: 5 }
      )
      await vi.waitFor(() => expect(finished).toHaveLength(1))

      expect(finished).toEqual([expect.objectContaining({ path, stopped: 'limit' })])
      expect(statSync(path).size).toBeLessThanOrEqual(MiB)
      expect(Number(probe(path, 'format=duration')[0])).toBeGreaterThan(0)
    },
    30_000
  )
})
