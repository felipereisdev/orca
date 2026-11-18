import { appendFile } from 'node:fs/promises'
import { Writable } from 'node:stream'
import type { FfmpegChild, FfmpegExit, SpawnFfmpeg } from '../desktop-ffmpeg'

export type FakeFfmpegOptions = {
  /** Bytes appended to the output per frame read. */
  bytesPerFrame?: number
  /** Bytes appended on close, like the MP4 index written at finalize. */
  indexBytes?: number
  /** Exit code once stdin closes. */
  exitCode?: number
  /** Never exits on its own after stdin closes; only `exit` ends it. */
  hangOnClose?: boolean
}

export type FakeFfmpeg = {
  spawn: SpawnFfmpeg
  /** Command and args of every spawn. */
  readonly spawns: { command: string; args: string[] }[]
  /** Every chunk written to stdin of the latest spawn: one per frame. */
  readonly frames: Buffer[]
  /** Whether the latest spawn was killed. */
  readonly killed: boolean
  /** Holds write callbacks, so stdin stays undrained until `release`. */
  hold(): void
  release(): void
  /** Ends the latest spawn as if the process closed with this code or signal. */
  exit(code: number | null, signal?: NodeJS.Signals | null): void
}

/**
 * Stands in for ffmpeg: appends `bytesPerFrame` per frame read, honors `-fs` by finalizing once
 * the output reaches it, and appends `indexBytes` when it finalizes, as the MP4 index lands last.
 */
export function createFakeFfmpeg({
  bytesPerFrame = 100,
  indexBytes = 0,
  exitCode = 0,
  hangOnClose = false
}: FakeFfmpegOptions = {}): FakeFfmpeg {
  const spawns: { command: string; args: string[] }[] = []
  const frames: Buffer[] = []
  let held: (() => void)[] | undefined
  let killed = false
  let exit = (_result: FfmpegExit): void => {}
  return {
    spawns,
    frames,
    get killed() {
      return killed
    },
    spawn: (command, args) => {
      spawns.push({ command, args })
      frames.length = 0
      killed = false
      const output = args.at(-1) ?? ''
      const fsIndex = args.indexOf('-fs')
      const fileLimit = fsIndex !== -1 ? Number(args[fsIndex + 1]) : Infinity
      let done = false
      let written = 0
      /** Output reaches the disk asynchronously, as a real encoder's does. */
      let disk = Promise.resolve()
      const append = (bytes: number): void => {
        disk = disk.then(() => appendFile(output, Buffer.alloc(bytes)))
      }
      let resolveExited = (_result: FfmpegExit): void => {}
      const exited = new Promise<FfmpegExit>((resolve) => {
        resolveExited = resolve
      })
      // Closes once everything written reached the disk; stdin goes away with the process.
      exit = (result) => {
        done = true
        queueMicrotask(() => stdin.destroy())
        void disk.then(() => resolveExited(result))
      }
      const finalize = (): void => {
        if (done) {
          return
        }
        append(indexBytes)
        exit({ code: exitCode, signal: null })
      }
      const stdin: Writable = new Writable({
        highWaterMark: 1,
        write(chunk: Buffer, _encoding, callback) {
          if (done) {
            callback()
            return
          }
          frames.push(Buffer.from(chunk))
          append(bytesPerFrame)
          written += bytesPerFrame
          if (written >= fileLimit) {
            finalize()
          }
          if (held) {
            held.push(callback)
          } else {
            callback()
          }
        },
        final(callback) {
          callback()
          if (!hangOnClose) {
            finalize()
          }
        }
      })
      const child: FfmpegChild = {
        stdin,
        exited,
        kill: () => {
          killed = true
        }
      }
      return child
    },
    hold: () => {
      held ??= []
    },
    release: () => {
      const callbacks = held ?? []
      held = undefined
      for (const callback of callbacks) {
        callback()
      }
    },
    exit: (code, signal = null) => exit({ code, signal })
  }
}
