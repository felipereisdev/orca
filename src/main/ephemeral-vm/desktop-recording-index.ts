import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { desktopRecordingIdFromPath } from '../../shared/native-chat/media/native-chat-video-path'
import { isCopiedRecordingKnown, noteCopiedRecording } from './desktop-recording-copies'

export { RECORDING_ID, localRecordingPath, noteCopiedRecording } from './desktop-recording-copies'

export function recordingsRoot(): string {
  return join(app.getPath('userData'), 'desktop-recordings')
}

/** Workspace ids hold `::` and checkout paths; their directory is named by a digest instead. */
export function recordingsDirForWorkspace(workspaceId: string): string {
  const key = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32)
  return join(recordingsRoot(), key)
}

export function recordingFileName(id: string): string {
  return `rec-${id}.mp4`
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
      const id = desktopRecordingIdFromPath(name)
      if (id && !isCopiedRecordingKnown(id)) {
        noteCopiedRecording(id, join(root, workspace, name))
      }
    }
  }
}
