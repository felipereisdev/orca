import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

// The environment names recordings `rec-<16 hex>.mp4`; anything else is not one of its files.
export const RECORDING_ID = /^[0-9a-f]{16}$/
const RECORDING_FILE = /^rec-([0-9a-f]{16})\.mp4$/

// Kept in memory so media lookups never block the main thread on disk.
const copiedRecordings = new Map<string, string>()

export function recordingsRoot(): string {
  return join(app.getPath('userData'), 'desktop-recordings')
}

export function recordingFileName(id: string): string {
  return `rec-${id}.mp4`
}

export function noteCopiedRecording(recordingId: string, path: string): void {
  copiedRecordings.set(recordingId, path)
}

/** The Mac copy of an environment recording, if one was copied for any workspace. */
export function localRecordingPath(recordingId: string): string | null {
  return RECORDING_ID.test(recordingId) ? (copiedRecordings.get(recordingId) ?? null) : null
}

async function listOrEmpty(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** Learns the copies earlier sessions made; temp files never match the final name. */
export async function indexLocalRecordings(): Promise<void> {
  const root = recordingsRoot()
  for (const workspace of await listOrEmpty(root)) {
    for (const name of await listOrEmpty(join(root, workspace))) {
      const id = RECORDING_FILE.exec(name)?.[1]
      if (id && !copiedRecordings.has(id)) {
        copiedRecordings.set(id, join(root, workspace, name))
      }
    }
  }
}
