import { randomBytes } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MAX_FILE_RANGE_READ_BYTES } from '../../shared/file-content/file-range-read'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import {
  readRemotePreviewChunk,
  RemotePreviewGrantLapsedError,
  renewRemotePreviewGrant,
  type GrantedRemoteFilePreviewAddress
} from '../media/remote-file-preview-reader'

const GRANT_TIMEOUT_MS = 15_000
const MAX_GRANT_RENEWALS = 3

export type EnvironmentRecording = { id: string; path: string; bytes: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The environment grants the recording's absolute path, as it does a file a terminal names. */
async function grantRecording(
  environmentId: string,
  workspaceId: string,
  path: string,
  signal: AbortSignal
): Promise<GrantedRemoteFilePreviewAddress> {
  const worktree = `id:${workspaceId}`
  const response = await callRuntimeEnvironment(
    getRuntimeEnvironmentRegistryRoot(),
    environmentId,
    'files.resolveTerminalPath',
    { worktree, pathText: path },
    GRANT_TIMEOUT_MS,
    undefined,
    undefined,
    { signal }
  )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const target =
    isRecord(response.result) && isRecord(response.result.openTarget)
      ? response.result.openTarget
      : null
  if (
    target?.kind !== 'absolute-file' ||
    typeof target.grantId !== 'string' ||
    typeof target.absolutePath !== 'string'
  ) {
    throw new Error('The environment did not grant the recording file.')
  }
  return { environmentId, worktree, grantId: target.grantId, absolutePath: target.absolutePath }
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
  let address = await grantRecording(args.environmentId, args.workspaceId, recording.path, signal)
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
        if (!(error instanceof RemotePreviewGrantLapsedError) || renewals >= MAX_GRANT_RENEWALS) {
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
      await handle.write(chunk, 0, chunk.byteLength, offset)
      offset += chunk.byteLength
    }
    await handle.sync()
    await handle.close()
    closed = true
    await rename(temp, args.destination)
  } catch (error) {
    if (!closed) {
      await handle.close().catch(() => {})
    }
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}
