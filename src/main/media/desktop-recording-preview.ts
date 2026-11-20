import type { Store } from '../persistence/loading-store/store'
import { localRecordingPath } from '../ephemeral-vm/desktop-recording-copies'
import { readLocalFilePreview } from './media-preview-protocol'
import type { PreviewSender, PreviewUrl } from './preview-grant-registry'

/** The Mac's copy of an environment recording, streamed by range; null when none was copied. */
export function grantDesktopRecordingPreview(
  event: { sender: PreviewSender },
  recordingId: string,
  store: Store
): Promise<PreviewUrl | null> {
  const filePath = localRecordingPath(recordingId)
  // The copy lives in Orca's own data folder, outside every project root.
  return filePath
    ? readLocalFilePreview(event, { filePath, access: { kind: 'user-file' } }, store, {
        documents: false
      })
    : Promise.resolve(null)
}
