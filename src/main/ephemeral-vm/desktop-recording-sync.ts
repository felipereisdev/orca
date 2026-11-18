import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { copyEnvironmentRecording, type EnvironmentRecording } from './desktop-recording-copy'
import { keepDesktopEventsStream } from './desktop-events-stream'
import {
  noteCopiedRecording,
  RECORDING_ID,
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

function parseRecording(value: unknown): EnvironmentRecording | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !RECORDING_ID.test(value.id) ||
    typeof value.path !== 'string' ||
    !value.path.endsWith(`/${recordingFileName(value.id)}`) ||
    typeof value.bytes !== 'number' ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0
  ) {
    return null
  }
  return { id: value.id, path: value.path, bytes: value.bytes }
}

async function isCopied(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch {
    return false
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Keeps a copy on this Mac of every recording the environment finishes, through one serialized
 * worker per workspace. Stream `ready`, `recording-finished` and the retry timer only mark a pass
 * as needed and wake the loop; a pass lists the environment's recordings and copies the missing
 * ones one at a time. A pass with any failure doubles the retry delay (5 s up to 5 min); only a
 * pass with none resets it. Only the loop touches the timer and the failure count.
 */
export function syncEnvironmentRecordings(
  runtimeEnvironmentId: string,
  workspaceId: string
): () => void {
  activeSyncs.get(workspaceId)?.()
  const controller = new AbortController()
  const { signal } = controller
  const dir = recordingsDirForWorkspace(workspaceId)
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
      const recording = parseRecording(entry)
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
      const destination = join(dir, recordingFileName(recording.id))
      try {
        if (!(await isCopied(destination))) {
          await mkdir(dir, { recursive: true, mode: 0o700 })
          await copyEnvironmentRecording({
            environmentId: runtimeEnvironmentId,
            workspaceId,
            recording,
            destination,
            signal
          })
        }
        noteCopiedRecording(recording.id, destination)
      } catch (error) {
        failed = true
        if (!signal.aborted) {
          console.warn('[desktop] recording copy failed; retrying', {
            recordingId: recording.id,
            error: describeError(error)
          })
        }
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
        const delay = Math.min(RETRY_INITIAL_MS * 2 ** failedPasses, RETRY_MAX_MS)
        failedPasses += 1
        // A wake during the pass already asked for the next one; it runs now instead.
        if (!passNeeded) {
          retryTimer = setTimeout(() => {
            retryTimer = null
            wake()
          }, delay)
        }
      }
    } finally {
      looping = false
    }
  }

  function wake(): void {
    if (signal.aborted) {
      return
    }
    passNeeded = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (!looping) {
      void loop()
    }
  }

  keepDesktopEventsStream(
    runtimeEnvironmentId,
    (event) => {
      if (event.type === 'ready' || event.type === 'recording-finished') {
        wake()
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
  return stop
}
