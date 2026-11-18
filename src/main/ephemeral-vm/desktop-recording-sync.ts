import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  callRuntimeEnvironment,
  subscribeRuntimeEnvironment
} from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { copyEnvironmentRecording, type EnvironmentRecording } from './desktop-recording-copy'
import {
  noteCopiedRecording,
  RECORDING_ID,
  recordingFileName,
  recordingsRoot
} from './desktop-recording-index'

const LIST_TIMEOUT_MS = 15_000
const RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 60_000]
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/

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

function isSafeWorkspaceSegment(workspaceId: string): boolean {
  return SAFE_PATH_SEGMENT.test(workspaceId) && workspaceId !== '.' && workspaceId !== '..'
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
 * event copies that file, and every (re)connect reconciles the environment's list, so recordings
 * finished while disconnected, and copies that failed, are picked up there.
 */
export function syncEnvironmentRecordings(
  runtimeEnvironmentId: string,
  workspaceId: string
): () => void {
  if (!isSafeWorkspaceSegment(workspaceId)) {
    return () => {}
  }
  activeSyncs.get(workspaceId)?.()
  const controller = new AbortController()
  const { signal } = controller
  const dir = join(recordingsRoot(), workspaceId)
  const pending = new Map<string, EnvironmentRecording>()
  const inFlight = new Set<string>()
  let copies: Promise<void> = Promise.resolve()
  let subscription: { close: () => void } | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0

  const copy = (recording: EnvironmentRecording): void => {
    if (signal.aborted || inFlight.has(recording.id)) {
      return
    }
    inFlight.add(recording.id)
    pending.delete(recording.id)
    copies = copies
      .then(async () => {
        const destination = join(dir, recordingFileName(recording.id))
        if (signal.aborted) {
          return
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
      })
      .catch((error: unknown) => {
        if (signal.aborted) {
          return
        }
        pending.set(recording.id, recording)
        console.warn('[desktop] recording copy failed; retrying on the next reconcile', {
          recordingId: recording.id,
          error: describeError(error)
        })
      })
      .finally(() => {
        inFlight.delete(recording.id)
      })
  }

  const reconcile = async (): Promise<void> => {
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
      const listed = isRecord(response.result) ? response.result.recordings : undefined
      for (const entry of Array.isArray(listed) ? listed : []) {
        const recording = parseRecording(entry)
        if (recording) {
          copy(recording)
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        console.warn('[desktop] listing recordings failed', { error: describeError(error) })
      }
    }
  }

  const onStreamEvent = (event: unknown): void => {
    if (!isRecord(event)) {
      return
    }
    if (event.type === 'ready') {
      reconnectAttempt = 0
      void reconcile()
      return
    }
    if (event.type === 'recording-finished') {
      const recording = parseRecording(event)
      if (recording) {
        copy(recording)
      }
      for (const retry of pending.values()) {
        copy(retry)
      }
    }
  }

  const scheduleReconnect = (): void => {
    subscription = null
    if (signal.aborted || reconnectTimer) {
      return
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function connect(): void {
    let ended = false
    const end = (): void => {
      if (!ended) {
        ended = true
        scheduleReconnect()
      }
    }
    subscribeRuntimeEnvironment(
      getRuntimeEnvironmentRegistryRoot(),
      runtimeEnvironmentId,
      'desktop.events',
      {},
      undefined,
      {
        onEvent: (payload) => {
          if (ended) {
            return
          }
          if (payload.type === 'response' && payload.response.ok) {
            onStreamEvent(payload.response.result)
          } else if (payload.type === 'response' || payload.type === 'error') {
            // A refusal (another controller, no desktop yet) or a midstream failure ends this stream.
            subscription?.close()
            end()
          }
        },
        onClose: end
      },
      () => !signal.aborted && !ended,
      signal
    ).then(
      (opened) => {
        if (signal.aborted || ended) {
          opened.close()
          return
        }
        subscription = opened
      },
      (error: unknown) => {
        if (!signal.aborted) {
          console.warn('[desktop] recording events unavailable; retrying', {
            error: describeError(error)
          })
        }
        end()
      }
    )
  }

  const stop = (): void => {
    if (signal.aborted) {
      return
    }
    controller.abort()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    subscription?.close()
    subscription = null
    if (activeSyncs.get(workspaceId) === stop) {
      activeSyncs.delete(workspaceId)
    }
  }
  activeSyncs.set(workspaceId, stop)
  connect()
  return stop
}
