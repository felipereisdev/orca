import { chmodSync } from 'node:fs'
import { errnoCodeOrUnknown } from '../../shared/errors/errno-code'
import type { DesktopFrame } from './desktop-control-connection'
import { DesktopError } from './desktop-errors'
import {
  ffmpegRecordArgs,
  findFfmpeg as findFfmpegOnPath,
  spawnFfmpeg as spawnRealFfmpeg,
  type FfmpegChild,
  type SpawnFfmpeg
} from './desktop-ffmpeg'
import {
  defaultRecordingsDir,
  listRecordings,
  newRecordingFile,
  preparePrivateRecordingsDir,
  recordingBytes,
  type DesktopRecordingEntry
} from './desktop-recording-files'

const FRAME_INTERVAL_MS = 100
const FRAMES_PER_SECOND = 1000 / FRAME_INTERVAL_MS
/** How long ffmpeg may take to finalize the MP4 after stdin closes before it is killed. */
const FINALIZE_TIMEOUT_MS = 30_000

export type DesktopFrameSource = {
  onFrame(cb: (frame: DesktopFrame) => void): () => void
  /** The latest complete frame, if the desktop is ready. */
  currentFrame(): DesktopFrame | undefined
}

export type DesktopRecorderDeps = {
  findFfmpeg?: () => string | null
  spawnFfmpeg?: SpawnFfmpeg
}

export type DesktopRecordingStartOptions = { maxSeconds: number; maxBytes: number; dir: string }

/** `failed`: ffmpeg exited on its own; the file holds whatever it wrote. */
export type DesktopRecordingStopReason = 'requested' | 'limit' | 'failed'

export type DesktopRecordingResult = {
  id: string
  path: string
  seconds: number
  bytes: number
  stopped: DesktopRecordingStopReason
}

type Session = {
  id: string
  path: string
  width: number
  height: number
  maxTicks: number
  maxBytes: number
  child: FfmpegChild
  timer: ReturnType<typeof setInterval>
  unsubscribe: () => void
  /** A frame published since the last write; read only when written (each read copies it). */
  pending: DesktopFrame | undefined
  last: Buffer | undefined
  blank: Buffer | undefined
  ticks: number
  frames: number
  private: boolean
  finishing: Promise<DesktopRecordingResult> | undefined
}

/** Copies `rgba` into a buffer of the starting size: cropped, and padded with opaque black. */
function fitFrame(session: Session, frame: DesktopFrame): Buffer {
  const rgba = frame.rgba()
  if (frame.width === session.width && frame.height === session.height) {
    return rgba
  }
  if (!session.blank) {
    session.blank = Buffer.alloc(session.width * session.height * 4)
    for (let alpha = 3; alpha < session.blank.length; alpha += 4) {
      session.blank[alpha] = 255
    }
  }
  const fitted = Buffer.from(session.blank)
  const rowBytes = Math.min(frame.width, session.width) * 4
  const rows = Math.min(frame.height, session.height)
  for (let y = 0; y < rows; y++) {
    const from = y * frame.width * 4
    rgba.copy(fitted, y * session.width * 4, from, from + rowBytes)
  }
  return fitted
}

/**
 * Records the desktop to an MP4 by piping the latest frame to ffmpeg every 100 ms. A tick whose
 * previous frame ffmpeg has not taken yet is skipped, so a slow encoder never queues frames.
 */
export class DesktopRecorder {
  #session: Session | undefined
  readonly #finishedListeners = new Set<(result: DesktopRecordingResult) => void>()
  readonly #findFfmpeg: () => string | null
  readonly #spawnFfmpeg: SpawnFfmpeg

  constructor(
    private readonly source: DesktopFrameSource,
    {
      findFfmpeg = () => findFfmpegOnPath(),
      spawnFfmpeg = spawnRealFfmpeg
    }: DesktopRecorderDeps = {}
  ) {
    this.#findFfmpeg = findFfmpeg
    this.#spawnFfmpeg = spawnFfmpeg
  }

  active(): boolean {
    return this.#session !== undefined
  }

  /** Called whenever a recording finishes, on request, at a limit or because ffmpeg exited. */
  onFinished(cb: (result: DesktopRecordingResult) => void): () => void {
    this.#finishedListeners.add(cb)
    return () => this.#finishedListeners.delete(cb)
  }

  list(dir: string = defaultRecordingsDir()): DesktopRecordingEntry[] {
    return listRecordings(dir)
  }

  start({ maxSeconds, maxBytes, dir }: DesktopRecordingStartOptions): { id: string; path: string } {
    if (this.#session) {
      throw new DesktopError('desktop_already_recording')
    }
    const ffmpeg = this.#findFfmpeg()
    if (!ffmpeg) {
      throw new DesktopError('desktop_recording_unavailable', 'ffmpeg_not_found')
    }
    const frame = this.source.currentFrame()
    if (!frame) {
      throw new DesktopError('desktop_unavailable')
    }
    const { id, path } = newRecordingFile(dir)
    let child: FfmpegChild
    try {
      preparePrivateRecordingsDir(dir)
      child = this.#spawnFfmpeg(ffmpeg, ffmpegRecordArgs(frame.width, frame.height, path))
    } catch (error) {
      if (error instanceof DesktopError) {
        throw error
      }
      throw new DesktopError('desktop_recording_unavailable', errnoCodeOrUnknown(error))
    }
    // A dead encoder surfaces through `exited`; a write after it died must not throw.
    child.stdin.on('error', () => {})
    const session: Session = {
      id,
      path,
      width: frame.width,
      height: frame.height,
      maxTicks: Math.ceil((maxSeconds * 1000) / FRAME_INTERVAL_MS),
      maxBytes,
      child,
      timer: setInterval(() => this.#tick(session), FRAME_INTERVAL_MS),
      unsubscribe: this.source.onFrame((next) => {
        session.pending = next
      }),
      pending: frame,
      last: undefined,
      blank: undefined,
      ticks: 0,
      frames: 0,
      private: false,
      finishing: undefined
    }
    this.#session = session
    void child.exited.then(() => {
      if (this.#session === session && !session.finishing) {
        void this.#finish(session, 'failed')
      }
    })
    return { id, path }
  }

  stop(): Promise<DesktopRecordingResult> {
    const session = this.#session
    if (!session) {
      return Promise.reject(new DesktopError('desktop_not_recording'))
    }
    return this.#finish(session, 'requested')
  }

  #tick(session: Session): void {
    if (session.finishing) {
      return
    }
    session.ticks++
    this.#makePrivate(session)
    if (recordingBytes(session.path) >= session.maxBytes) {
      void this.#finish(session, 'limit')
      return
    }
    const { stdin } = session.child
    if (stdin.writable && !stdin.writableNeedDrain) {
      const pending = session.pending
      session.pending = undefined
      const buffer = pending ? fitFrame(session, pending) : session.last
      if (buffer) {
        session.last = buffer
        stdin.write(buffer)
        session.frames++
      }
    }
    if (session.ticks >= session.maxTicks) {
      void this.#finish(session, 'limit')
    }
  }

  /** ffmpeg creates the file with its own umask; ours is 0600 as soon as it exists. */
  #makePrivate(session: Session): void {
    if (session.private || process.platform === 'win32') {
      return
    }
    try {
      chmodSync(session.path, 0o600)
      session.private = true
    } catch {
      // Not created yet.
    }
  }

  #finish(session: Session, stopped: DesktopRecordingStopReason): Promise<DesktopRecordingResult> {
    session.finishing ??= (async () => {
      clearInterval(session.timer)
      session.unsubscribe()
      session.child.stdin.end()
      let killTimer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        session.child.exited,
        new Promise<void>((resolve) => {
          killTimer = setTimeout(() => {
            session.child.kill()
            resolve()
          }, FINALIZE_TIMEOUT_MS)
        })
      ])
      clearTimeout(killTimer)
      session.private = false
      this.#makePrivate(session)
      const result: DesktopRecordingResult = {
        id: session.id,
        path: session.path,
        seconds: session.frames / FRAMES_PER_SECOND,
        bytes: recordingBytes(session.path),
        stopped
      }
      this.#session = undefined
      for (const listener of this.#finishedListeners) {
        listener(result)
      }
      return result
    })()
    return session.finishing
  }
}
