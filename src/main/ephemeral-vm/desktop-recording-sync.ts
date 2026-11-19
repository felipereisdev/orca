import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { copyEnvironmentRecording, type EnvironmentRecording } from './desktop-recording-copy'
import { keepDesktopEventsStream } from './desktop-events-stream'
import { parseEnvironmentRecording } from './desktop-recording-copies'
import {
  noteCopiedRecording,
  recordingFileName,
  recordingsDirForWorkspace
} from './desktop-recording-index'

const LIST_TIMEOUT_MS = 15_000
const RETRY_INITIAL_MS = 5_000
const RETRY_MAX_MS = 5 * 60_000

const activeSyncs = new Map<string, () => void>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function isCopied(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Copies one environment recording into the workspace's folder on this Mac unless it is there, then
 * indexes it. A cancellation between steps throws before touching the disk or the index again.
 */
export async function keepRecordingOnMac(args: {
  environmentId: string
  workspaceId: string
  recording: EnvironmentRecording
  signal: AbortSignal
}): Promise<void> {
  const { recording, signal } = args
  const dir = recordingsDirForWorkspace(args.workspaceId)
  const destination = join(dir, recordingFileName(recording.id))
  const copied = await isCopied(destination)
  signal.throwIfAborted()
  if (!copied) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    signal.throwIfAborted()
    await copyEnvironmentRecording({
      environmentId: args.environmentId,
      workspaceId: args.workspaceId,
      recording,
      destination,
      signal
    })
    signal.throwIfAborted()
  }
  noteCopiedRecording(recording.id, destination)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Keeps a copy on this Mac of every recording the environment finishes, through one serialized
 * worker per workspace. The first pass runs on start; stream `ready` and `recording-finished` only
 * mark another pass as needed. A pass lists the environment's recordings and copies the missing
 * ones one at a time. A pass with any failure arms the retry timer (5 s, doubling up to 5 min) and
 * only that timer starts the next pass; only a pass with none resets the delay. Once stopped, a
 * pass checks after every await and returns without touching the disk, the index or the timer.
 */
export function syncEnvironmentRecordings(
  runtimeEnvironmentId: string,
  workspaceId: string
): () => void {
  activeSyncs.get(workspaceId)?.()
  const controller = new AbortController()
  const { signal } = controller
  let passNeeded = false
  let looping = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let failedPasses = 0

  async function listRecordings(): Promise<EnvironmentRecording[]> {
    const response = await callRuntimeEnvironment(
      getRuntimeEnvironmentRegistryRoot(),
      runtimeEnvironmentId,
      'desktop.recordings.list',
      {},
      LIST_TIMEOUT_MS,
      undefined,
      undefined,
      { signal }
    )
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    const listed = isRecord(response.result) ? response.result.recordings : undefined
    return (Array.isArray(listed) ? listed : []).flatMap((entry) => {
      const recording = parseEnvironmentRecording(entry)
      return recording ? [recording] : []
    })
  }

  /** One list-and-copy pass; true when anything in it failed. */
  async function runPass(): Promise<boolean> {
    let recordings: EnvironmentRecording[]
    try {
      recordings = await listRecordings()
    } catch (error) {
      if (!signal.aborted) {
        console.warn('[desktop] listing recordings failed; retrying', {
          error: describeError(error)
        })
      }
      return true
    }
    let failed = false
    for (const recording of recordings) {
      if (signal.aborted) {
        return failed
      }
      try {
        await keepRecordingOnMac({
          environmentId: runtimeEnvironmentId,
          workspaceId,
          recording,
          signal
        })
      } catch (error) {
        if (signal.aborted) {
          return true
        }
        failed = true
        console.warn('[desktop] recording copy failed; retrying', {
          recordingId: recording.id,
          error: describeError(error)
        })
      }
    }
    return failed
  }

  async function loop(): Promise<void> {
    looping = true
    try {
      while (passNeeded && !signal.aborted) {
        passNeeded = false
        const failed = await runPass()
        if (signal.aborted) {
          return
        }
        if (!failed) {
          failedPasses = 0
          continue
        }
        // Only this timer starts the next pass; events until then only keep `passNeeded` set.
        const delay = Math.min(RETRY_INITIAL_MS * 2 ** failedPasses, RETRY_MAX_MS)
        failedPasses += 1
        retryTimer = setTimeout(() => {
          retryTimer = null
          requestPass()
        }, delay)
        return
      }
    } finally {
      looping = false
    }
  }

  /** Marks a pass as needed; it starts now unless a pass is running or a retry is pending. */
  function requestPass(): void {
    if (signal.aborted) {
      return
    }
    passNeeded = true
    if (!looping && !retryTimer) {
      void loop()
    }
  }

  keepDesktopEventsStream(
    runtimeEnvironmentId,
    (event) => {
      if (event.type === 'ready' || event.type === 'recording-finished') {
        requestPass()
      }
    },
    signal
  )

  const stop = (): void => {
    if (signal.aborted) {
      return
    }
    controller.abort()
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (activeSyncs.get(workspaceId) === stop) {
      activeSyncs.delete(workspaceId)
    }
  }
  activeSyncs.set(workspaceId, stop)
  // The list RPC needs no stream; the stream only adds live wakeups.
  requestPass()
  return stop
}
