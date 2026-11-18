import { appendFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import type { FfmpegChild, SpawnFfmpeg } from '../desktop-ffmpeg'

export type FakeFfmpeg = {
  spawn: SpawnFfmpeg
  /** Command and args of every spawn. */
  readonly spawns: { command: string; args: string[] }[]
  /** Every chunk written to stdin of the latest spawn: one per frame. */
  readonly frames: Buffer[]
  /** Holds write callbacks, so stdin stays undrained until `release`. */
  hold(): void
  release(): void
  /** Exits as if ffmpeg crashed. */
  crash(): void
}

/** Stands in for ffmpeg: appends `bytesPerFrame` bytes to the output path per frame it reads. */
export function createFakeFfmpeg({ bytesPerFrame = 100 }: { bytesPerFrame?: number } = {}) {
  const spawns: { command: string; args: string[] }[] = []
  const frames: Buffer[] = []
  let held: (() => void)[] | undefined
  let exit = (): void => {}
  const fake: FakeFfmpeg = {
    spawns,
    frames,
    spawn: (command, args) => {
      spawns.push({ command, args })
      frames.length = 0
      const output = args.at(-1) ?? ''
      let resolveExited = (): void => {}
      const exited = new Promise<void>((resolve) => {
        resolveExited = resolve
      })
      exit = resolveExited
      const stdin = new Writable({
        highWaterMark: 1,
        write(chunk: Buffer, _encoding, callback) {
          frames.push(Buffer.from(chunk))
          appendFileSync(output, Buffer.alloc(bytesPerFrame))
          if (held) {
            held.push(callback)
          } else {
            callback()
          }
        },
        final(callback) {
          callback()
          resolveExited()
        }
      })
      const child: FfmpegChild = { stdin, exited, kill: () => resolveExited() }
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
    crash: () => exit()
  }
  return fake
}
