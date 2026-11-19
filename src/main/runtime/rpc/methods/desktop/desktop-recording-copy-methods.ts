import { DesktopError } from '../../../../desktop/desktop-errors'
import { localRecordingPath } from '../../../../ephemeral-vm/desktop-recording-copies'
import { openLocalRegularFile } from '../../../../filesystem/local-file-io/local-regular-file-read'
import { readLocalFileRange } from '../../../../filesystem/local-file-io/local-file-range-read'
import {
  DesktopRecordingCopyReadChunkParams,
  DesktopRecordingCopyStatParams
} from '../../../../../shared/rpc-contract/desktop/desktop-params'
import { defineMethod } from '../../core'

function requireCopy(recordingId: string): string {
  const path = localRecordingPath(recordingId)
  if (!path) {
    throw new DesktopError('desktop_recording_not_found')
  }
  return path
}

/**
 * The Mac's copies of environment recordings, paged as `files.stat`/`files.readChunk` page a file,
 * so a phone still plays a recording after its environment is gone. Ids only: never a path.
 */
export const DESKTOP_RECORDING_COPY_METHODS = [
  defineMethod({
    name: 'desktop.recordings.copyStat',
    permission: 'workspace',
    params: DesktopRecordingCopyStatParams,
    handler: async (params) => {
      const { handle, stats } = await openLocalRegularFile(requireCopy(params.recordingId))
      await handle.close()
      return { size: stats.size, isDirectory: false, mtime: stats.mtimeMs, ctime: stats.ctimeMs }
    }
  }),
  defineMethod({
    name: 'desktop.recordings.copyReadChunk',
    permission: 'workspace',
    params: DesktopRecordingCopyReadChunkParams,
    handler: async (params) =>
      readLocalFileRange(requireCopy(params.recordingId), params.offset, params.length)
  })
]
