// Electron-free so RPC methods and media grants can look copies up in any process.
import type { EnvironmentRecording } from './desktop-recording-copy'

// The environment names recordings `rec-<16 hex>.mp4`; anything else is not one of its files.
export const RECORDING_ID = /^[0-9a-f]{16}$/

// Kept in memory so media lookups never block the main thread on disk.
const copiedRecordings = new Map<string, string>()

export function noteCopiedRecording(recordingId: string, path: string): void {
  copiedRecordings.set(recordingId, path)
}

export function isCopiedRecordingKnown(recordingId: string): boolean {
  return copiedRecordings.has(recordingId)
}

/** The Mac copy of an environment recording, if one was copied for any workspace. */
export function localRecordingPath(recordingId: string): string | null {
  return RECORDING_ID.test(recordingId) ? (copiedRecordings.get(recordingId) ?? null) : null
}

export function recordingFileName(id: string): string {
  return `rec-${id}.mp4`
}

/** One entry of `desktop.recordings.list`, or null when it is not a finished recording file. */
export function parseEnvironmentRecording(value: unknown): EnvironmentRecording | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const entry: Record<string, unknown> = { ...value }
  if (
    typeof entry.id !== 'string' ||
    !RECORDING_ID.test(entry.id) ||
    typeof entry.path !== 'string' ||
    !entry.path.endsWith(`/${recordingFileName(entry.id)}`) ||
    typeof entry.bytes !== 'number' ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes <= 0
  ) {
    return null
  }
  return { id: entry.id, path: entry.path, bytes: entry.bytes }
}
