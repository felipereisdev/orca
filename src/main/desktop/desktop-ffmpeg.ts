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

/**
 * Encodes raw RGBA frames read from stdin at 10 fps into an H.264 MP4 at `output`; the muxer
 * stops on its own once the file reaches `maxFileBytes`.
 */
export function ffmpegRecordArgs(
  width: number,
  height: number,
  maxFileBytes: number,
  output: string
): string[] {
  // prettier-ignore
  return [
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', '10', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-fs', String(maxFileBytes), output
  ]
}

export const spawnFfmpeg: SpawnFfmpeg = (command, args) => {
  // Output is ignored: an unread stderr pipe would fill up and stall the encoder.
  const child = spawnProcess({ program: command, args, stdio: ['pipe', 'ignore', 'ignore'] })
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
  return { stdin, exited, kill: () => child.kill('SIGKILL') }
}
