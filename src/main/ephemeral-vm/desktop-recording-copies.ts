// Electron-free so RPC methods and media grants can look copies up in any process.

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
