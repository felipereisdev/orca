import { randomBytes } from 'node:crypto'
import { open, rename, rm, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MAX_FILE_RANGE_READ_BYTES } from '../../shared/file-content/file-range-read'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import type { RemoteFilePreviewAddress } from '../../shared/file-preview/remote-file-preview-address'
import {
  readRemotePreviewChunk,
  RemotePreviewGrantLapsedError,
  renewRemotePreviewGrant
} from '../media/remote-file-preview-reader'

const GRANT_TIMEOUT_MS = 15_000
const MAX_GRANT_RENEWALS = 3

export type EnvironmentRecording = { id: string; path: string; bytes: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Where the environment serves the recording: a file inside the workspace checkout by its relative
 * path, any other file by the grant it mints for the absolute path, as for a file a terminal names.
 */
async function locateRecording(
  environmentId: string,
  workspaceId: string,
  path: string,
  signal: AbortSignal
): Promise<RemoteFilePreviewAddress> {
  const response = await callRuntimeEnvironment(
    getRuntimeEnvironmentRegistryRoot(),
    environmentId,
    'files.resolveTerminalPath',
    { worktree: `id:${workspaceId}`, pathText: path },
    GRANT_TIMEOUT_MS,
    undefined,
    undefined,
    { signal }
  )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const resolved = isRecord(response.result) ? response.result : null
  const target = resolved && isRecord(resolved.openTarget) ? resolved.openTarget : null
  // The resolver answers with the workspace that owns the path, which can be another one.
  const worktree =
    typeof resolved?.worktree === 'string' ? `id:${resolved.worktree}` : `id:${workspaceId}`
  if (target?.kind === 'worktree-file' && typeof target.relativePath === 'string') {
    return { environmentId, worktree, relativePath: target.relativePath }
  }
  if (
    target?.kind === 'absolute-file' &&
    typeof target.grantId === 'string' &&
    typeof target.absolutePath === 'string'
  ) {
    return { environmentId, worktree, grantId: target.grantId, absolutePath: target.absolutePath }
  }
  throw new Error('The environment did not grant the recording file.')
}

/** Writes all of `chunk` at `position`; a write that makes no progress fails the copy. */
async function writeFully(handle: FileHandle, chunk: Uint8Array, position: number): Promise<void> {
  let written = 0
  while (written < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      written,
      chunk.byteLength - written,
      position + written
    )
    if (bytesWritten <= 0) {
      throw new Error('The recording copy stopped writing.')
    }
    written += bytesWritten
  }
}

/**
 * Copies a finished recording to `destination` through the environment's granted-file reads: a
 * private temp file beside it, renamed into place only once every expected byte arrived.
 */
export async function copyEnvironmentRecording(args: {
  environmentId: string
  workspaceId: string
  recording: EnvironmentRecording
  destination: string
  signal: AbortSignal
}): Promise<void> {
  const { recording, signal } = args
  let address = await locateRecording(args.environmentId, args.workspaceId, recording.path, signal)
  const temp = join(
    dirname(args.destination),
    `.rec-${recording.id}.${randomBytes(6).toString('hex')}.partial`
  )
  const handle = await open(temp, 'wx', 0o600)
  let closed = false
  try {
    let offset = 0
    let renewals = 0
    while (offset < recording.bytes) {
      let chunk: Uint8Array
      try {
        chunk = await readRemotePreviewChunk(
          address,
          offset,
          Math.min(MAX_FILE_RANGE_READ_BYTES, recording.bytes - offset),
          signal
        )
      } catch (error) {
        if (
          !(error instanceof RemotePreviewGrantLapsedError) ||
          address.grantId === undefined ||
          renewals >= MAX_GRANT_RENEWALS
        ) {
          throw error
        }
        renewals += 1
        address = await renewRemotePreviewGrant(address, signal)
        continue
      }
      if (chunk.byteLength === 0) {
        throw new Error(
          `Recording ${recording.id} ended after ${offset} of ${recording.bytes} bytes.`
        )
      }
      await writeFully(handle, chunk, offset)
      offset += chunk.byteLength
    }
    await handle.sync()
    await handle.close()
    closed = true
    // A cancellation that landed during fsync or close publishes nothing; the catch removes the temp.
    signal.throwIfAborted()
    await rename(temp, args.destination)
  } catch (error) {
    if (!closed) {
      await handle.close().catch(() => {})
    }
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}
