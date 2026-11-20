import { filePreviewExtension } from '../../file-preview/file-preview-kind'

const CHAT_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])
// The environment names recordings `rec-<16 hex>.mp4`; the Mac keeps its copy under the same id.
const DESKTOP_RECORDING_FILE = /^rec-([0-9a-f]{16})\.mp4$/

/** Videos a chat plays inline when its markdown names one as an image. */
export function isNativeChatVideoPath(path: string): boolean {
  return CHAT_VIDEO_EXTENSIONS.has(filePreviewExtension(path))
}

/** The recording id a desktop recording's file name carries, or null for any other file. */
export function desktopRecordingIdFromPath(path: string): string | null {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return DESKTOP_RECORDING_FILE.exec(name)?.[1] ?? null
}
