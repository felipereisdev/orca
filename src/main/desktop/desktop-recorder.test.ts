import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopFrame } from './desktop-control-connection'
import { findFfmpeg, spawnFfmpeg } from './desktop-ffmpeg'
import { DesktopRecorder, type DesktopRecordingResult } from './desktop-recorder'
import { createFakeFfmpeg } from './testing/fake-ffmpeg'

const ffmpegAvailable = findFfmpeg() !== null && process.platform !== 'win32'

type Pixel = [number, number, number, number]

function frame(width: number, height: number, pixel: Pixel): DesktopFrame {
  const pixels = Buffer.alloc(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set(pixel, offset)
  }
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

const RED: Pixel = [255, 0, 0, 255]
const BLUE: Pixel = [0, 0, 255, 255]
const LIMITS = { maxSeconds: 600, maxBytes: 200 * 1024 * 1024 }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-recorder-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function setup(opts: { bytesPerFrame?: number; ffmpegPath?: string | null } = {}) {
  const source = frameSource(frame(4, 2, RED))
  const ffmpeg = createFakeFfmpeg({ bytesPerFrame: opts.bytesPerFrame })
  const recorder = new DesktopRecorder(source, {
    findFfmpeg: () => (opts.ffmpegPath === undefined ? '/usr/bin/ffmpeg' : opts.ffmpegPath),
    spawnFfmpeg: ffmpeg.spawn
  })
  const finished: DesktopRecordingResult[] = []
  recorder.onFinished((result) => finished.push(result))
  return { source, ffmpeg, recorder, finished }
}

describe('DesktopRecorder', () => {
  it('writes rgba frames at 10 fps until stop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { source, ffmpeg, recorder, finished } = setup()
    const recordingsDir = join(dir, 'recordings')

    const { id, path } = recorder.start({ ...LIMITS, dir: recordingsDir })
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(path).toBe(join(recordingsDir, `rec-${id}.mp4`))
    expect(recorder.active()).toBe(true)
    expect(ffmpeg.spawns).toEqual([
      {
        command: '/usr/bin/ffmpeg',
        args: [
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgba',
          '-s',
          '4x2',
          '-r',
          '10',
          '-i',
          '-',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          path
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
    if (process.platform !== 'win32') {
      expect(statSync(recordingsDir).mode & 0o777).toBe(0o700)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('stops itself at maxSeconds with stopped: limit', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { ffmpeg, recorder, finished } = setup()

    const { id, path } = recorder.start({ ...LIMITS, maxSeconds: 2, dir })
    await vi.advanceTimersByTimeAsync(3000)

    expect(ffmpeg.frames).toHaveLength(20)
    expect(finished).toEqual([{ id, path, seconds: 2, bytes: 2000, stopped: 'limit' }])
    expect(recorder.active()).toBe(false)
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'desktop_not_recording' })
  })

  it('stops itself at maxBytes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { ffmpeg, recorder, finished } = setup({ bytesPerFrame: 1000 })

    const { id, path } = recorder.start({ ...LIMITS, maxBytes: 5000, dir })
    await vi.advanceTimersByTimeAsync(3000)

    expect(ffmpeg.frames).toHaveLength(5)
    expect(finished).toEqual([{ id, path, seconds: 0.5, bytes: 5000, stopped: 'limit' }])
  })

  it('pads frames to the starting size after a resize', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { source, ffmpeg, recorder } = setup()

    recorder.start({ ...LIMITS, dir })
    // Narrower and taller than the 4x2 start: columns are padded black, the extra row is cropped.
    source.publish(frame(2, 3, BLUE))
    await vi.advanceTimersByTimeAsync(100)
    await recorder.stop()

    const B = [...BLUE]
    const K = [0, 0, 0, 255]
    expect([...ffmpeg.frames[0]]).toEqual([...B, ...B, ...K, ...K, ...B, ...B, ...K, ...K])
  })

  it('skips ticks while ffmpeg has not drained stdin instead of queueing frames', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { ffmpeg, recorder } = setup()

    recorder.start({ ...LIMITS, dir })
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
    recorder.start({ ...LIMITS, dir })
    expect(() => recorder.start({ ...LIMITS, dir })).toThrow(
      expect.objectContaining({ code: 'desktop_already_recording' })
    )
    await recorder.stop()
  })

  it('missing ffmpeg → desktop_recording_unavailable', () => {
    const { recorder, ffmpeg } = setup({ ffmpegPath: null })

    expect(() => recorder.start({ ...LIMITS, dir })).toThrow(
      expect.objectContaining({ code: 'desktop_recording_unavailable' })
    )
    expect(ffmpeg.spawns).toEqual([])
    expect(recorder.active()).toBe(false)
  })

  it('reports an ffmpeg that exits on its own as failed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { ffmpeg, recorder, finished } = setup()

    const { id, path } = recorder.start({ ...LIMITS, dir })
    await vi.advanceTimersByTimeAsync(300)
    ffmpeg.crash()
    await vi.advanceTimersByTimeAsync(100)

    expect(finished).toEqual([{ id, path, seconds: 0.3, bytes: 300, stopped: 'failed' }])
    expect(recorder.active()).toBe(false)
  })

  it('lists only recordings in the directory', async () => {
    const { recorder } = setup()
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, 'rec-notanid.mp4'), 'x')
    writeFileSync(join(dir, 'rec-0123456789abcdef.mp4'), 'abc')

    expect(recorder.list(dir)).toEqual([
      {
        id: '0123456789abcdef',
        path: join(dir, 'rec-0123456789abcdef.mp4'),
        bytes: 3,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      }
    ])
    expect(recorder.list(join(dir, 'missing'))).toEqual([])
  })

  it.skipIf(!ffmpegAvailable)('produces a playable MP4 with real ffmpeg', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const source = frameSource(frame(64, 48, RED))
    const recorder = new DesktopRecorder(source, { spawnFfmpeg })

    const { path } = recorder.start({ ...LIMITS, dir })
    for (let tick = 0; tick < 20; tick++) {
      await vi.advanceTimersByTimeAsync(100)
      // Real pipes drain on real I/O; give ffmpeg a turn between ticks.
      await new Promise((resolve) => setImmediate(resolve))
    }
    const result = await recorder.stop()

    const duration = Number(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        path
      ]).toString()
    )
    expect(duration).toBeGreaterThan(0)
    expect(result.bytes).toBeGreaterThan(0)
  })
})
