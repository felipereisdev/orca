import { desktopRecordingIdFromPath } from '../../../../../src/shared/native-chat/media/native-chat-video-path'
import {
  downloadMobileMedia,
  mediaFileChunkSchema,
  mediaFileStatSchema,
  MobileMediaTooLargeError,
  type MobileMediaByteSource,
  type MobileMediaSink
} from '../../../files/media/mobile-file-media-download'
import { terminalPathResolutionSchema } from '../../../files/preview/file-preview-reply-schema'
import { rpcResultVariant } from '../../../transport/rpc/rpc-operation-result-reader'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../../transport/rpc/rpc-operation'
import type { MobileNativeChatImageSource } from './mobile-native-chat-image-preview'

const READ_OPTIONS = { failWhenDisconnected: true, timeoutMs: 30_000 }

const pathResolve = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.chat-video-resolve-path',
    method: 'files.resolveTerminalPath',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('terminal-path-resolution', terminalPathResolutionSchema)
  })
)
const grantedStat = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.chat-video-granted-stat',
    method: 'files.statTerminalArtifact',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileStatSchema
  })
)
const grantedChunk = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.chat-video-granted-chunk',
    method: 'files.readTerminalArtifactChunk',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileChunkSchema
  })
)
const workspaceStat = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.chat-video-stat',
    method: 'files.stat',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileStatSchema
  })
)
const workspaceChunk = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.chat-video-chunk',
    method: 'files.readChunk',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileChunkSchema
  })
)
const copyStat = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'desktop.recording-copy-stat',
    method: 'desktop.recordings.copyStat',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileStatSchema
  })
)
const copyChunk = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'desktop.recording-copy-chunk',
    method: 'desktop.recordings.copyReadChunk',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileChunkSchema
  })
)

/** The video's bytes where the chat's session runs: inside its workspace, or granted like a terminal path. */
async function hostVideoSource(
  { client, worktreeId }: MobileNativeChatImageSource,
  path: string
): Promise<MobileMediaByteSource> {
  const worktree = `id:${worktreeId}`
  const resolved = pathResolve.interpret(
    await pathResolve.request(client, { worktree, pathText: path }, READ_OPTIONS)
  )
  const target = resolved.openTarget
  if (target?.kind === 'absolute-file' && target.absolutePath && target.grantId) {
    const params = { worktree, grantId: target.grantId, absolutePath: target.absolutePath }
    return {
      stat: async () =>
        grantedStat.interpret(await grantedStat.request(client, params, READ_OPTIONS)),
      readChunk: async (offset, length) =>
        grantedChunk.interpret(
          await grantedChunk.request(client, { ...params, offset, length }, READ_OPTIONS)
        )
    }
  }
  const relativePath =
    target?.kind === 'worktree-file' && 'relativePath' in target ? target.relativePath : undefined
  if (typeof relativePath !== 'string') {
    throw new Error('The host does not serve this video')
  }
  const params = { worktree, relativePath }
  return {
    stat: async () =>
      workspaceStat.interpret(await workspaceStat.request(client, params, READ_OPTIONS)),
    readChunk: async (offset, length) =>
      workspaceChunk.interpret(
        await workspaceChunk.request(client, { ...params, offset, length }, READ_OPTIONS)
      )
  }
}

/** The paired Mac's copy of a desktop recording, which outlives the environment that made it. */
function recordingCopySource(
  { client }: MobileNativeChatImageSource,
  recordingId: string
): MobileMediaByteSource {
  return {
    stat: async () =>
      copyStat.interpret(await copyStat.request(client, { recordingId }, READ_OPTIONS)),
    readChunk: async (offset, length) =>
      copyChunk.interpret(
        await copyChunk.request(client, { recordingId, offset, length }, READ_OPTIONS)
      )
  }
}

/**
 * Pages a chat video into a sink chunk by chunk; a desktop recording its environment can no longer
 * serve plays from the Mac's copy. Each attempt gets its own sink.
 */
export async function downloadHostChatVideo(
  source: MobileNativeChatImageSource,
  path: string,
  createSink: () => MobileMediaSink,
  signal: AbortSignal,
  onProgress: (bytes: number, total: number) => void
): Promise<string> {
  try {
    return await downloadMobileMedia(
      await hostVideoSource(source, path),
      createSink(),
      signal,
      onProgress
    )
  } catch (error) {
    const recordingId = desktopRecordingIdFromPath(path)
    // The Mac's copy is the same size, so it is no way around the cap.
    if (!recordingId || signal.aborted || error instanceof MobileMediaTooLargeError) {
      throw error
    }
    return downloadMobileMedia(
      recordingCopySource(source, recordingId),
      createSink(),
      signal,
      onProgress
    )
  }
}
