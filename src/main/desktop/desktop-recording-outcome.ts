import { chmod, rename, rm } from 'node:fs/promises'
import { errnoCodeOrUnknown } from '../../shared/errors/errno-code'
import type { FfmpegExit } from './desktop-ffmpeg'

const MIN_BYTES_HEADROOM = 256 * 1024

/**
 * ffmpeg's `-fs` stop size, so the finalized file still fits `maxBytes`: the MP4 index and
 * whatever the encoder still buffers land after the muxer stopped.
 */
export function recordingStopBytes(maxBytes: number): number {
  const headroom = Math.max(MIN_BYTES_HEADROOM, Math.ceil(maxBytes * 0.02))
  return maxBytes - Math.min(headroom, Math.floor(maxBytes / 2))
}

/** Why a finalized recording is not a valid result, or undefined when it is. */
export function recordingFailureReason(
  exit: FfmpegExit,
  bytes: number,
  maxBytes: number
): string | undefined {
  if (exit.signal) {
    return `encoder_signal_${exit.signal}`
  }
  if (exit.code !== 0) {
    return `encoder_exit_${exit.code ?? 'unknown'}`
  }
  if (bytes === 0) {
    return 'recording_empty'
  }
  // Even rate control and -fs could not fit it: the budget is too small for this desktop.
  return bytes > maxBytes ? 'recording_limit_too_small' : undefined
}

/** Makes the finished file 0600 and gives it its listed name. */
export async function publishRecording(partialPath: string, path: string): Promise<void> {
  // ffmpeg created it with its own umask; the 0700 directory kept it private meanwhile.
  if (process.platform !== 'win32') {
    await chmod(partialPath, 0o600)
  }
  await rename(partialPath, path)
}

/** A leftover partial file stays hidden from listings; failing to remove it must not mask the error. */
export async function removePartialRecording(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch (error) {
    console.warn(
      '[desktop-recorder] Could not remove a failed recording:',
      errnoCodeOrUnknown(error)
    )
  }
}
