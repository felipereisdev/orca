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
 * Keeps a copy on this Mac of every recording the environment finishes: each `recording-finished`
 * event copies that file, every (re)connect reconciles the environment's list, and a failed list
 * or copy is retried on a backoff (5 s doubling to 5 min) while the connection stays up.
 */
export function syncEnvironmentRecordings(
  runtimeEnvironmentId: string,
  workspaceId: string
): () => void {
  activeSyncs.get(workspaceId)?.()
  const controller = new AbortController()
  const { signal } = controller
  const dir = recordingsDirForWorkspace(workspaceId)
  // Each queued copy's outcome, so every reconcile can await the copies it depends on.
  const inFlight = new Map<string, Promise<boolean>>()
  let copies: Promise<unknown> = Promise.resolve()
  let reconcileGeneration = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempt = 0

  const scheduleRetry = (): void => {
    if (signal.aborted || retryTimer) {
      return
    }
    const delay = Math.min(RETRY_INITIAL_MS * 2 ** retryAttempt, RETRY_MAX_MS)
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void reconcile()
    }, delay)
  }

  /** Queues one copy; resolves true once the file is on this Mac, false if this attempt failed. */
  const copy = (recording: EnvironmentRecording): Promise<boolean> => {
    const queued = inFlight.get(recording.id)
    if (queued) {
      return queued
    }
    if (signal.aborted) {
      return Promise.resolve(false)
    }
    const outcome = copies
      .then(async () => {
        const destination = join(dir, recordingFileName(recording.id))
        if (signal.aborted) {
          return false
        }
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
        return true
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          console.warn('[desktop] recording copy failed; retrying', {
            recordingId: recording.id,
            error: describeError(error)
          })
          scheduleRetry()
        }
        return false
      })
      .finally(() => {
        inFlight.delete(recording.id)
      })
    inFlight.set(recording.id, outcome)
    copies = outcome
    return outcome
  }

  /** Lists the environment's recordings and copies the missing ones; only the newest reconcile,
   *  with every copy it waited on succeeding, resets the retry backoff. */
  async function reconcile(): Promise<void> {
    const generation = ++reconcileGeneration
    let listed: unknown
    try {
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
      listed = isRecord(response.result) ? response.result.recordings : undefined
    } catch (error) {
      if (!signal.aborted) {
        console.warn('[desktop] listing recordings failed; retrying', {
          error: describeError(error)
        })
        scheduleRetry()
      }
      return
    }
    const outcomes: Promise<boolean>[] = []
    for (const entry of Array.isArray(listed) ? listed : []) {
      const recording = parseRecording(entry)
      if (recording) {
        outcomes.push(copy(recording))
      }
    }
    const succeeded = (await Promise.all(outcomes)).every(Boolean)
    if (succeeded && generation === reconcileGeneration && !signal.aborted) {
      retryAttempt = 0
    }
  }

  keepDesktopEventsStream(
    runtimeEnvironmentId,
    (event) => {
      if (event.type === 'ready') {
        void reconcile()
        return
      }
      if (event.type === 'recording-finished') {
        const recording = parseRecording(event)
        if (recording) {
          void copy(recording)
        }
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
