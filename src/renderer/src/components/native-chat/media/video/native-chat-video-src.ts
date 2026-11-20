import {
  acquireTerminalArtifactGrant,
  pinTerminalArtifactGrantTarget
} from '@/runtime/files/grants/runtime-terminal-artifact-grant'
import { readRuntimeTerminalArtifactContent } from '@/runtime/files/grants/runtime-terminal-artifact-read'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import { getRemoteFileArgs } from '@/runtime/files/runtime-file-routing'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { desktopRecordingIdFromPath } from '../../../../../../shared/native-chat/media/native-chat-video-path'

export type NativeChatVideoSrc = { url: string | null; fromCopy: boolean }

/** The video as an orca-media URL its player reads by range, never as bytes in memory. */
async function readHostVideoUrl(
  context: RuntimeFileOperationArgs,
  absolutePath: string
): Promise<string | null> {
  // This process cannot stream an SSH host's files.
  if (context.connectionId) {
    return null
  }
  const remote = getRemoteFileArgs(context, absolutePath)
  if (context.target.kind === 'environment' && context.worktreeId && !remote) {
    // Recordings live outside the checkout: the host grants that one path, as for a terminal link.
    const pinned = pinTerminalArtifactGrantTarget({
      target: context.target,
      worktreeId: context.worktreeId,
      absolutePath,
      expectedEnvironmentPairingRevision: context.expectedEnvironmentPairingRevision
    })
    const granted = await acquireTerminalArtifactGrant(pinned)
    if (!granted) {
      return null
    }
    const content = await readRuntimeTerminalArtifactContent(
      { ...pinned, absolutePath: granted.absolutePath, grantId: granted.grantId },
      { pageOversizedBinary: true }
    )
    return content.mediaUrl ?? null
  }
  const inWorkspace =
    remote && context.worktreeId
      ? remote.worktreeSelector === toRuntimeWorktreeSelector(context.worktreeId)
      : false
  const content = await readRuntimeFileContent({
    target: context.target,
    filePath: absolutePath,
    ...(inWorkspace && remote ? { relativePath: remote.relativePath } : {}),
    ...(context.worktreeId ? { worktreeId: context.worktreeId } : {}),
    expectedEnvironmentPairingRevision: context.expectedEnvironmentPairingRevision,
    pageOversizedBinary: true
  })
  return content.mediaUrl ?? null
}

/** The Mac's own copy of a desktop recording, which outlives the environment that made it. */
export async function readDesktopRecordingCopy(absolutePath: string): Promise<string | null> {
  const recordingId = desktopRecordingIdFromPath(absolutePath)
  if (!recordingId) {
    return null
  }
  try {
    return (await window.api.fs.grantDesktopRecordingPreview({ recordingId }))?.mediaUrl ?? null
  } catch {
    return null
  }
}

/** Reads the video where the chat's session runs; a recording that host can't serve plays from the Mac copy. */
export async function readNativeChatVideoSrc(
  context: RuntimeFileOperationArgs | null,
  absolutePath: string
): Promise<NativeChatVideoSrc> {
  const url = context ? await readHostVideoUrl(context, absolutePath).catch(() => null) : null
  if (url) {
    return { url, fromCopy: false }
  }
  const copy = await readDesktopRecordingCopy(absolutePath)
  return copy ? { url: copy, fromCopy: true } : { url: null, fromCopy: false }
}
