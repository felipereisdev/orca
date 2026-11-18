import { spawnProcess } from '@orca/process-host'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Writable } from 'node:stream'

/** How the encoder process closed; `code` is null when it died from a signal or never spawned. */
export type FfmpegExit = { code: number | null; signal: NodeJS.Signals | null }

export type FfmpegChild = {
  readonly stdin: Writable
  /** Settles once the process closed, however it ended. */
  readonly exited: Promise<FfmpegExit>
  /** The muxed duration ffmpeg last reported, in microseconds. */
  outTimeMicros(): number | undefined
  kill(): void
}

export type SpawnFfmpeg = (command: string, args: string[]) => FfmpegChild

/** The absolute path of executable `name` on PATH, or null when it is not installed. */
export async function findExecutableOnPath(
  name: string,
  path: string | undefined = process.env.PATH
): Promise<string | null> {
  const file = process.platform === 'win32' ? `${name}.exe` : name
  for (const dir of (path ?? '').split(delimiter).filter(isAbsolute)) {
    const candidate = join(dir, file)
    try {
      if (!(await stat(candidate)).isFile()) {
        continue
      }
      if (process.platform !== 'win32') {
        await access(candidate, constants.X_OK)
      }
      return candidate
    } catch {
      continue
    }
  }
  return null
}

export function findFfmpeg(path?: string): Promise<string | null> {
  return findExecutableOnPath('ffmpeg', path)
}

/** Keeps a recording's bitrate, and so single frames, bounded for its byte budget. */
const MIN_MAXRATE_KBPS = 250
const MAX_MAXRATE_KBPS = 20_000
/** Share of the budget for video; the rest covers the MP4 index and rate-control overshoot. */
const VIDEO_BUDGET_SHARE = 0.85
/** At most 1920x1080 with the aspect ratio kept and even sides, as yuv420p needs. */
const DOWNSCALE_FILTER =
  "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"

/** The x264 `-maxrate`/`-bufsize` that spreads `maxBytes` over `maxSeconds`, within sane bounds. */
export function recordingMaxrateKbps(maxBytes: number, maxSeconds: number): number {
  const kbps = Math.floor((maxBytes * 8 * VIDEO_BUDGET_SHARE) / maxSeconds / 1000)
  return Math.min(MAX_MAXRATE_KBPS, Math.max(MIN_MAXRATE_KBPS, kbps))
}

export type FfmpegRecordOptions = {
  width: number
  height: number
  maxrateKbps: number
  /** The muxer stops on its own once the file reaches this size. */
  maxFileBytes: number
  output: string
}

/**
 * Encodes raw RGBA frames read from stdin at 10 fps into an H.264 MP4 at `output`, reporting
 * progress (`out_time_us`) on stderr.
 */
export function ffmpegRecordArgs({
  width,
  height,
  maxrateKbps,
  maxFileBytes,
  output
}: FfmpegRecordOptions): string[] {
  const rate = `${maxrateKbps}k`
  // prettier-ignore
  return [
    '-hide_banner', '-nostats', '-progress', 'pipe:2',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', '10', '-i', '-',
    '-vf', DOWNSCALE_FILTER,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-maxrate', rate, '-bufsize', rate,
    '-movflags', '+faststart', '-fs', String(maxFileBytes), output
  ]
}

const OUT_TIME_US = /^out_time_us=(\d+)$/
/** Longest partial line kept between chunks; progress lines are far shorter. */
const MAX_PARTIAL_LINE = 256

/** Follows ffmpeg's `-progress` lines; everything else on stderr is dropped. */
export function createFfmpegProgressReader(): {
  push(chunk: string): void
  outTimeMicros(): number | undefined
} {
  let partial = ''
  let outTime: number | undefined
  return {
    push: (chunk) => {
      const lines = (partial + chunk).split('\n')
      partial = (lines.pop() ?? '').slice(-MAX_PARTIAL_LINE)
      for (const line of lines) {
        const match = OUT_TIME_US.exec(line.trim())
        if (match) {
          outTime = Number(match[1])
        }
      }
    },
    outTimeMicros: () => outTime
  }
}

/** How long ffmpeg may take to finalize the MP4 after stdin closes before it is killed. */
const FINALIZE_TIMEOUT_MS = 30_000

/** Waits for the encoder to close, killing it past the finalize timeout and waiting on. */
export async function waitForFfmpegClose(child: FfmpegChild): Promise<FfmpegExit> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), FINALIZE_TIMEOUT_MS)
  })
  const exit = await Promise.race([child.exited, timedOut])
  clearTimeout(timer)
  if (exit) {
    return exit
  }
  child.kill()
  return child.exited
}

export const spawnFfmpeg: SpawnFfmpeg = (command, args) => {
  // stderr is always read: an unread pipe would fill up and stall the encoder.
  const child = spawnProcess({ program: command, args, stdio: ['pipe', 'ignore', 'pipe'] })
  const progress = createFfmpegProgressReader()
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => progress.push(chunk))
  const exited = new Promise<FfmpegExit>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }))
    // Only a spawn failure ends it here; a running process still reports through close.
    child.once('error', () => {
      if (child.pid === undefined) {
        resolve({ code: null, signal: null })
      }
    })
  })
  const stdin = child.stdin
  if (!stdin) {
    throw new Error('ffmpeg stdin is not a pipe')
  }
  return {
    stdin,
    exited,
    outTimeMicros: progress.outTimeMicros,
    kill: () => child.kill('SIGKILL')
  }
}
