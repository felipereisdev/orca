import * as z from 'zod'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import type { MobileFilePreviewRpcSender } from '../preview/mobile-file-preview-operations'
import type { MobileFileMedia } from './mobile-file-media'
import { isMobileMethodUnavailableError } from '../../transport/rpc/mobile-method-unavailable'
import { decodeBase64Bytes } from '../../transport/encryption/base64-byte-codec'

export const MOBILE_MEDIA_CHUNK_BYTES = 384 * 1024
export const MOBILE_MEDIA_MAX_BYTES = 256 * 1024 * 1024

export const mediaFileStatSchema = rpcResultVariant(
  'media-file-stat',
  z.looseObject({
    size: z.number().int().nonnegative(),
    isDirectory: z.boolean(),
    mtime: z.number().finite(),
    ctime: z.number().finite().optional()
  })
)

export const mediaFileChunkSchema = rpcResultVariant(
  'media-file-chunk',
  z.looseObject({
    contentBase64: z
      .string()
      .max((MOBILE_MEDIA_CHUNK_BYTES * 4) / 3)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    bytesRead: z.number().int().min(0).max(MOBILE_MEDIA_CHUNK_BYTES),
    eof: z.boolean()
  })
)

const statRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.media-preview-stat',
    method: 'files.stat',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileStatSchema
  })
)
const chunkRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.media-preview-chunk',
    method: 'files.readChunk',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: mediaFileChunkSchema
  })
)

export type MobileMediaFileStat = {
  size: number
  isDirectory: boolean
  mtime: number
  ctime?: number
}
export type MobileMediaFileChunk = { contentBase64: string; bytesRead: number; eof: boolean }

/** Where a media file's bytes come from: its host's stat and chunk reads for one file. */
export type MobileMediaByteSource = {
  stat(): Promise<MobileMediaFileStat>
  readChunk(offset: number, length: number): Promise<MobileMediaFileChunk>
}

export type MobileMediaSink = {
  append(bytes: Uint8Array): void
  finish(): string
  dispose(): void
}

// Typed so the shell can tell the page an update is needed; retrying cannot help.
export class MobileMediaHostOutdatedError extends Error {
  constructor() {
    super('Update Orca on your desktop to preview media files on mobile')
    this.name = 'MobileMediaHostOutdatedError'
  }
}

export function downloadMobileFileMedia(
  client: MobileFilePreviewRpcSender,
  media: MobileFileMedia,
  sink: MobileMediaSink,
  signal: AbortSignal,
  onProgress: (bytes: number, total: number) => void
): Promise<string> {
  const params = { worktree: `id:${media.worktreeId}`, relativePath: media.relativePath }
  const options = { failWhenDisconnected: true, timeoutMs: 30_000 }
  const source: MobileMediaByteSource = {
    stat: async () => {
      const reply = await statRead.request(client, params, options)
      if (!reply.ok && isMobileMethodUnavailableError(reply.error.code, reply.error.message)) {
        throw new MobileMediaHostOutdatedError()
      }
      return statRead.interpret(reply)
    },
    readChunk: async (offset, length) =>
      chunkRead.interpret(await chunkRead.request(client, { ...params, offset, length }, options))
  }
  return downloadMobileMedia(source, sink, signal, onProgress)
}

/** Pages a media file into `sink` chunk by chunk, so no reply ever carries the whole file. */
/** Past the phone's cap; checked from the stat before any byte is read. */
export class MobileMediaTooLargeError extends Error {
  constructor() {
    super('Files larger than 256 MB cannot be previewed on mobile')
    this.name = 'MobileMediaTooLargeError'
  }
}

export async function downloadMobileMedia(
  source: MobileMediaByteSource,
  sink: MobileMediaSink,
  signal: AbortSignal,
  onProgress: (bytes: number, total: number) => void
): Promise<string> {
  try {
    checkDownloadActive(signal)
    const stat = await source.stat()
    checkDownloadActive(signal)
    if (stat.isDirectory || stat.size === 0) {
      throw new Error('This file has no playable media')
    }
    if (stat.size > MOBILE_MEDIA_MAX_BYTES) {
      throw new MobileMediaTooLargeError()
    }
    let offset = 0
    while (offset < stat.size) {
      checkDownloadActive(signal)
      const length = Math.min(MOBILE_MEDIA_CHUNK_BYTES, stat.size - offset)
      const chunk = await source.readChunk(offset, length)
      checkDownloadActive(signal)
      const bytes = decodeBase64Bytes(chunk.contentBase64)
      if (
        bytes.byteLength !== chunk.bytesRead ||
        chunk.bytesRead === 0 ||
        chunk.bytesRead > length ||
        (chunk.eof && offset + chunk.bytesRead !== stat.size)
      ) {
        throw new Error('File changed during download. Retry the preview')
      }
      sink.append(bytes)
      offset += chunk.bytesRead
      onProgress(offset, stat.size)
    }
    const latest = await source.stat()
    checkDownloadActive(signal)
    if (
      latest.isDirectory ||
      latest.size !== stat.size ||
      latest.mtime !== stat.mtime ||
      (stat.ctime !== undefined && latest.ctime !== stat.ctime)
    ) {
      throw new Error('File changed during download. Retry the preview')
    }
    return sink.finish()
  } catch (error) {
    sink.dispose()
    throw error
  }
}

function checkDownloadActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Media download cancelled')
  }
}
