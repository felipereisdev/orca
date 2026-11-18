import { spawnProcess } from '@orca/process-host'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Writable } from 'node:stream'

export type FfmpegChild = {
  readonly stdin: Writable
  /** Settles once the process is gone, however it ended. */
  readonly exited: Promise<void>
  kill(): void
}

export type SpawnFfmpeg = (command: string, args: string[]) => FfmpegChild

/** The absolute path of `ffmpeg` on PATH, or null when it is not installed. */
export function findFfmpeg(path: string | undefined = process.env.PATH): string | null {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  for (const dir of (path ?? '').split(delimiter).filter(isAbsolute)) {
    const candidate = join(dir, name)
    try {
      if (!statSync(candidate).isFile()) {
        continue
      }
      if (process.platform !== 'win32') {
        accessSync(candidate, constants.X_OK)
      }
      return candidate
    } catch {
      continue
    }
  }
  return null
}

/** Encodes raw RGBA frames read from stdin at 10 fps into an H.264 MP4 at `output`. */
export function ffmpegRecordArgs(width: number, height: number, output: string): string[] {
  // prettier-ignore
  return [
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', '10', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output
  ]
}

export const spawnFfmpeg: SpawnFfmpeg = (command, args) => {
  // Output is ignored: an unread stderr pipe would fill up and stall the encoder.
  const child = spawnProcess({ program: command, args, stdio: ['pipe', 'ignore', 'ignore'] })
  const exited = new Promise<void>((resolve) => {
    child.once('close', () => resolve())
    child.once('error', () => resolve())
  })
  const stdin = child.stdin
  if (!stdin) {
    throw new Error('ffmpeg stdin is not a pipe')
  }
  return { stdin, exited, kill: () => child.kill('SIGKILL') }
}
