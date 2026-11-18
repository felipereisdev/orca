import { errnoCodeOrUnknown } from '../../shared/errors/errno-code'
import type { DesktopFrame } from './desktop-control-connection'
import { DesktopError } from './desktop-errors'
import {
  ffmpegRecordArgs,
  findFfmpeg as findFfmpegOnPath,
  recordingMaxrateKbps,
  spawnFfmpeg as spawnRealFfmpeg,
  waitForFfmpegClose,
  type FfmpegChild,
  type SpawnFfmpeg
} from './desktop-ffmpeg'
import { evenCanvas, fitFrame, type RecordingCanvas } from './desktop-recording-canvas'
import {
  publishRecording,
  recordingFailureReason,
  recordingStopBytes,
  removePartialRecording
} from './desktop-recording-outcome'
import {
  defaultRecordingsDir,
  listRecordings,
  newRecordingFile,
  preparePrivateRecordingsDir,
  recordingBytes,
  type DesktopRecordingEntry
} from './desktop-recording-files'

const FRAME_INTERVAL_MS = 100
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
  /** Creates the private recordings directory. */
  prepareDir?: (dir: string) => Promise<void>
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
  canvas: RecordingCanvas
  deadline: number
  maxBytes: number
  child: FfmpegChild
  timer: ReturnType<typeof setInterval>
  unsubscribe: () => void
  /** A frame published since the last write; read only when written (each read copies it). */
  pending: DesktopFrame | undefined
  last: Buffer | undefined
  frames: number
  /** A `stop()` caller is waiting on the result, so a failure reaches it directly. */
  joined: boolean
  finishing: Promise<DesktopRecordingResult> | undefined
}

function cancelledStart(): DesktopError {
  return new DesktopError('desktop_unavailable', 'recording_cancelled')
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
  /** A start between its checks and its spawn; `stop()` and `close()` cancel it. */
  #pending: { cancelled: boolean } | undefined
  readonly #finishedListeners = new Set<(result: DesktopRecordingResult) => void>()
  readonly #findFfmpeg: () => Promise<string | null> | string | null
  readonly #spawnFfmpeg: SpawnFfmpeg
  readonly #now: () => number
  readonly #prepareDir: (dir: string) => Promise<void>

  constructor(
    private readonly source: DesktopFrameSource,
    {
      findFfmpeg = () => findFfmpegOnPath(),
      spawnFfmpeg = spawnRealFfmpeg,
      now = () => performance.now(),
      prepareDir = preparePrivateRecordingsDir
    }: DesktopRecorderDeps = {}
  ) {
    this.#prepareDir = prepareDir
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
    if (this.#session || this.#pending) {
      throw new DesktopError('desktop_already_recording')
    }
    const pending = { cancelled: false }
    this.#pending = pending
    try {
      return await this.#start(opts, pending)
    } catch (error) {
      // Whatever a later await did, a cancelled start reports the cancellation.
      throw pending.cancelled ? cancelledStart() : error
    } finally {
      if (this.#pending === pending) {
        this.#pending = undefined
      }
    }
  }

  /** Ends whatever runs: a pending start never spawns, an active recording is finalized. */
  close(): void {
    if (this.#pending) {
      this.#pending.cancelled = true
    }
    if (this.#session) {
      this.stop().catch(() => {})
    }
  }

  async #start(
    { maxSeconds, maxBytes, dir }: DesktopRecordingStartOptions,
    pending: { cancelled: boolean }
  ): Promise<{ id: string; path: string }> {
    const assertNotCancelled = (): void => {
      if (pending.cancelled) {
        throw cancelledStart()
      }
    }
    const ffmpeg = await this.#findFfmpeg()
    assertNotCancelled()
    if (!ffmpeg) {
      throw new DesktopError('desktop_recording_unavailable', 'ffmpeg_not_found')
    }
    try {
      await this.#prepareDir(dir)
    } catch (error) {
      throw error instanceof DesktopError
        ? error
        : new DesktopError('desktop_recording_unavailable', errnoCodeOrUnknown(error))
    }
    assertNotCancelled()
    // Read after the awaits, so the starting size is the desktop's current one.
    const frame = this.source.currentFrame()
    if (!frame) {
      throw new DesktopError('desktop_unavailable')
    }
    const canvas = evenCanvas(frame)
    const stopBytes = recordingStopBytes(maxBytes)
    const { id, path, partialPath } = newRecordingFile(dir)
    let child: FfmpegChild
    try {
      child = this.#spawnFfmpeg(
        ffmpeg,
        ffmpegRecordArgs({
          width: canvas.width,
          height: canvas.height,
          maxrateKbps: recordingMaxrateKbps(maxBytes, maxSeconds),
          maxFileBytes: stopBytes,
          output: partialPath
        })
      )
    } catch (error) {
      throw new DesktopError('desktop_recording_unavailable', errnoCodeOrUnknown(error))
    }
    this.#failure = undefined
    // A dead encoder surfaces through `exited`; a write after it died must not throw.
    child.stdin.on('error', () => {})
    const session: Session = {
      id,
      path,
      partialPath,
      canvas,
      deadline: this.#now() + maxSeconds * 1000,
      maxBytes,
      child,
      timer: setInterval(() => this.#tick(session), FRAME_INTERVAL_MS),
      unsubscribe: this.source.onFrame((next) => {
        session.pending = next
      }),
      pending: frame,
      last: undefined,
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
    if (!session && this.#pending) {
      // Nothing records yet: the start is cancelled and rejects with desktop_unavailable.
      this.#pending.cancelled = true
      return Promise.reject(new DesktopError('desktop_not_recording'))
    }
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
    const buffer = pending ? fitFrame(session.canvas, pending) : session.last
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
    const exit = await waitForFfmpegClose(session.child)
    const bytes = await recordingBytes(session.partialPath)
    const reason =
      cause === 'encoder_exited'
        ? 'encoder_exited'
        : recordingFailureReason(exit, bytes, session.maxBytes)
    let failure = reason ? new DesktopError('desktop_recording_failed', reason) : undefined
    if (!failure) {
      try {
        await publishRecording(session.partialPath, session.path)
      } catch (error) {
        failure = new DesktopError('desktop_recording_failed', errnoCodeOrUnknown(error))
      }
    }
    if (failure) {
      await removePartialRecording(session.partialPath)
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
      // What ffmpeg muxed: frames written after -fs stopped the muxer never made it in.
      seconds: (session.child.outTimeMicros() ?? 0) / 1_000_000,
      bytes,
      stopped: cause === 'limit' ? 'limit' : 'requested'
    }
    for (const listener of this.#finishedListeners) {
      listener(result)
    }
    return result
  }
}
