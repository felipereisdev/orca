import { chmod, rename, rm } from 'node:fs/promises'
import { errnoCodeOrUnknown } from '../../shared/errors/errno-code'
import type { DesktopFrame } from './desktop-control-connection'
import { DesktopError } from './desktop-errors'
import {
  ffmpegRecordArgs,
  findFfmpeg as findFfmpegOnPath,
  spawnFfmpeg as spawnRealFfmpeg,
  type FfmpegChild,
  type FfmpegExit,
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
const MIN_BYTES_HEADROOM = 256 * 1024

/**
 * ffmpeg's `-fs` stop size, so the finalized file still fits `maxBytes`: the MP4 index and
 * whatever the encoder still buffers land after the muxer stopped.
 */
export function recordingStopBytes(maxBytes: number): number {
  const headroom = Math.max(MIN_BYTES_HEADROOM, Math.ceil(maxBytes * 0.02))
  return maxBytes - Math.min(headroom, Math.floor(maxBytes / 2))
}

export type DesktopFrameSource = {
  onFrame(cb: (frame: DesktopFrame) => void): () => void
  /** The latest complete frame, if the desktop is ready. */
  currentFrame(): DesktopFrame | undefined
}

export type DesktopRecorderDeps = {
  findFfmpeg?: () => Promise<string | null> | string | null
  spawnFfmpeg?: SpawnFfmpeg
  /** Monotonic milliseconds for the `maxSeconds` deadline. */
  now?: () => number
}

export type DesktopRecordingStartOptions = { maxSeconds: number; maxBytes: number; dir: string }

export type DesktopRecordingResult = {
  id: string
  path: string
  seconds: number
  bytes: number
  stopped: 'requested' | 'limit'
}

/** `encoder_exited`: ffmpeg closed before anyone asked it to. */
type FinishCause = 'requested' | 'limit' | 'encoder_exited'

type Session = {
  id: string
  path: string
  partialPath: string
  /** The canvas every frame is fitted to: the starting size, rounded up to even. */
  width: number
  height: number
  deadline: number
  maxBytes: number
  child: FfmpegChild
  timer: ReturnType<typeof setInterval>
  unsubscribe: () => void
  /** A frame published since the last write; read only when written (each read copies it). */
  pending: DesktopFrame | undefined
  last: Buffer | undefined
  blank: Buffer | undefined
  frames: number
  /** A `stop()` caller is waiting on the result, so a failure reaches it directly. */
  joined: boolean
  finishing: Promise<DesktopRecordingResult> | undefined
}

/** Copies `rgba` onto the session canvas: cropped, and padded with opaque black. */
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

function failureReason(exit: FfmpegExit, bytes: number, maxBytes: number): string | undefined {
  if (exit.signal) {
    return `encoder_signal_${exit.signal}`
  }
  if (exit.code !== 0) {
    return `encoder_exit_${exit.code ?? 'unknown'}`
  }
  if (bytes === 0) {
    return 'recording_empty'
  }
  return bytes > maxBytes ? 'recording_over_max_bytes' : undefined
}

/**
 * Records the desktop to an MP4 by piping the latest frame to ffmpeg every 100 ms. A tick whose
 * previous frame ffmpeg has not taken yet is skipped, so a slow encoder never queues frames.
 * Only a clean encoder exit publishes `rec-<id>.mp4`; anything else removes the partial file.
 */
export class DesktopRecorder {
  #session: Session | undefined
  /** A background finish that failed, reported to the next `stop()`. */
  #failure: DesktopError | undefined
  /** A start is between its checks and its spawn; a second start is refused meanwhile. */
  #starting = false
  readonly #finishedListeners = new Set<(result: DesktopRecordingResult) => void>()
  readonly #findFfmpeg: () => Promise<string | null> | string | null
  readonly #spawnFfmpeg: SpawnFfmpeg
  readonly #now: () => number

  constructor(
    private readonly source: DesktopFrameSource,
    {
      findFfmpeg = () => findFfmpegOnPath(),
      spawnFfmpeg = spawnRealFfmpeg,
      now = () => performance.now()
    }: DesktopRecorderDeps = {}
  ) {
    this.#findFfmpeg = findFfmpeg
    this.#spawnFfmpeg = spawnFfmpeg
    this.#now = now
  }

  active(): boolean {
    return this.#session !== undefined
  }

  /** Called whenever a recording finishes cleanly, on request or at a limit. */
  onFinished(cb: (result: DesktopRecordingResult) => void): () => void {
    this.#finishedListeners.add(cb)
    return () => this.#finishedListeners.delete(cb)
  }

  list(dir: string = defaultRecordingsDir()): Promise<DesktopRecordingEntry[]> {
    return listRecordings(dir)
  }

  async start(opts: DesktopRecordingStartOptions): Promise<{ id: string; path: string }> {
    if (this.#session || this.#starting) {
      throw new DesktopError('desktop_already_recording')
    }
    this.#starting = true
    try {
      return await this.#start(opts)
    } finally {
      this.#starting = false
    }
  }

  async #start({
    maxSeconds,
    maxBytes,
    dir
  }: DesktopRecordingStartOptions): Promise<{ id: string; path: string }> {
    const ffmpeg = await this.#findFfmpeg()
    if (!ffmpeg) {
      throw new DesktopError('desktop_recording_unavailable', 'ffmpeg_not_found')
    }
    const frame = this.source.currentFrame()
    if (!frame) {
      throw new DesktopError('desktop_unavailable')
    }
    // yuv420p subsamples chroma 2x2: libx264 refuses odd sizes.
    const width = frame.width + (frame.width % 2)
    const height = frame.height + (frame.height % 2)
    const stopBytes = recordingStopBytes(maxBytes)
    const { id, path, partialPath } = newRecordingFile(dir)
    let child: FfmpegChild
    try {
      await preparePrivateRecordingsDir(dir)
      child = this.#spawnFfmpeg(ffmpeg, ffmpegRecordArgs(width, height, stopBytes, partialPath))
    } catch (error) {
      if (error instanceof DesktopError) {
        throw error
      }
      throw new DesktopError('desktop_recording_unavailable', errnoCodeOrUnknown(error))
    }
    this.#failure = undefined
    // A dead encoder surfaces through `exited`; a write after it died must not throw.
    child.stdin.on('error', () => {})
    const session: Session = {
      id,
      path,
      partialPath,
      width,
      height,
      deadline: this.#now() + maxSeconds * 1000,
      maxBytes,
      child,
      timer: setInterval(() => this.#tick(session), FRAME_INTERVAL_MS),
      unsubscribe: this.source.onFrame((next) => {
        session.pending = next
      }),
      pending: frame,
      last: undefined,
      blank: undefined,
      frames: 0,
      joined: false,
      finishing: undefined
    }
    this.#session = session
    void child.exited.then(async (exit) => {
      // `-fs` makes ffmpeg finalize and exit on its own once the file reached the stop size.
      const atLimit = exit.code === 0 && (await recordingBytes(partialPath)) >= stopBytes
      if (this.#session === session && !session.finishing) {
        this.#finishInBackground(session, atLimit ? 'limit' : 'encoder_exited')
      }
    })
    return { id, path }
  }

  stop(): Promise<DesktopRecordingResult> {
    const session = this.#session
    if (!session) {
      const failure = this.#failure
      this.#failure = undefined
      return Promise.reject(failure ?? new DesktopError('desktop_not_recording'))
    }
    session.joined = true
    return this.#finish(session, 'requested')
  }

  #tick(session: Session): void {
    if (session.finishing) {
      return
    }
    this.#writeFrame(session)
    if (this.#now() >= session.deadline) {
      this.#finishInBackground(session, 'limit')
    }
  }

  #writeFrame(session: Session): void {
    const { stdin } = session.child
    if (!stdin.writable || stdin.writableNeedDrain) {
      return
    }
    const pending = session.pending
    session.pending = undefined
    const buffer = pending ? fitFrame(session, pending) : session.last
    if (buffer) {
      session.last = buffer
      stdin.write(buffer)
      session.frames++
    }
  }

  #finishInBackground(session: Session, cause: FinishCause): void {
    // A failure is kept for the next `stop()` by `#finalize`.
    this.#finish(session, cause).catch(() => {})
  }

  #finish(session: Session, cause: FinishCause): Promise<DesktopRecordingResult> {
    session.finishing ??= this.#finalize(session, cause).finally(() => {
      if (this.#session === session) {
        this.#session = undefined
      }
    })
    return session.finishing
  }

  async #finalize(session: Session, cause: FinishCause): Promise<DesktopRecordingResult> {
    clearInterval(session.timer)
    session.unsubscribe()
    // An empty input is not a video: the encoder gets at least the starting frame.
    if (session.frames === 0) {
      this.#writeFrame(session)
    }
    session.child.stdin.end()
    const exit = await this.#closed(session.child)
    const bytes = await recordingBytes(session.partialPath)
    const reason =
      cause === 'encoder_exited' ? 'encoder_exited' : failureReason(exit, bytes, session.maxBytes)
    let failure = reason ? new DesktopError('desktop_recording_failed', reason) : undefined
    if (!failure) {
      try {
        // ffmpeg created it with its own umask; the 0700 directory kept it private meanwhile.
        if (process.platform !== 'win32') {
          await chmod(session.partialPath, 0o600)
        }
        await rename(session.partialPath, session.path)
      } catch (error) {
        failure = new DesktopError('desktop_recording_failed', errnoCodeOrUnknown(error))
      }
    }
    if (failure) {
      await rm(session.partialPath, { force: true })
    }
    // Settled before anyone hears of the outcome: status, the next stop and the files agree.
    if (this.#session === session) {
      this.#session = undefined
    }
    if (failure) {
      if (!session.joined) {
        this.#failure = failure
      }
      throw failure
    }
    const result: DesktopRecordingResult = {
      id: session.id,
      path: session.path,
      seconds: session.frames / FRAMES_PER_SECOND,
      bytes,
      stopped: cause === 'limit' ? 'limit' : 'requested'
    }
    for (const listener of this.#finishedListeners) {
      listener(result)
    }
    return result
  }

  /** Waits for the encoder to close, killing it past the finalize timeout. */
  async #closed(child: FfmpegChild): Promise<FfmpegExit> {
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
}
