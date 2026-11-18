import { useCallback, useEffect, useState } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'

export type DesktopOwner = 'agent' | 'user'

export type DesktopStatus = {
  state: 'unconfigured' | 'connecting' | 'ready' | 'unavailable'
  reason?: string
  owner: DesktopOwner
  width?: number
  height?: number
  recording: boolean
}

export type DesktopView =
  | { kind: 'connecting' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; owner: DesktopOwner; recording: boolean }

export type DesktopActions = {
  takeControl: () => void
  handBack: () => void
  startRecording: () => void
  stopRecording: () => void
  retry: () => void
}

const STATUS_POLL_MS = 3_000

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown'
}

export function desktopView(
  target: RuntimeClientTarget | null,
  status: DesktopStatus | null,
  lost: boolean
): DesktopView {
  if (!target || target.kind !== 'environment' || lost || status?.state === 'unavailable') {
    return { kind: 'unavailable' }
  }
  if (status?.state !== 'ready') {
    return { kind: 'connecting' }
  }
  return { kind: 'ready', owner: status.owner, recording: status.recording }
}

/** Polls `desktop.status` until the returned stop runs; a failed read keeps polling. */
function pollDesktopStatus(
  target: RuntimeClientTarget,
  onStatus: (status: DesktopStatus) => void,
  onFailure: () => void
): () => void {
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const poll = async (): Promise<void> => {
    try {
      const next = await callRuntimeRpc<DesktopStatus>(target, 'desktop.status', {})
      if (active) {
        onStatus(next)
      }
    } catch {
      if (active) {
        onFailure()
      }
    }
    if (active) {
      timer = setTimeout(() => void poll(), STATUS_POLL_MS)
    }
  }
  void poll()
  return () => {
    active = false
    clearTimeout(timer)
  }
}

/**
 * The desktop's status, polled while the tab is open, and the actions its toolbar runs. `lost`
 * covers a failed status read or a dropped viewer; retry clears it and opens a new viewer.
 */
export function useDesktopSession(target: RuntimeClientTarget | null, viewerId: string) {
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const [lost, setLost] = useState(false)
  const [connection, setConnection] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target || target.kind !== 'environment') {
      return
    }
    return pollDesktopStatus(
      target,
      (next) => {
        setStatus(next)
        // A desktop that went down and came back gets a fresh viewer without a retry.
        if (next.state !== 'ready') {
          setLost(false)
        }
      },
      () => setLost(true)
    )
  }, [target])

  const run = useCallback(
    <T>(method: string, params: unknown, apply: (result: T) => void): void => {
      if (!target) {
        return
      }
      setBusy(true)
      setError(null)
      callRuntimeRpc<T>(target, method, params)
        .then(apply, (reason: unknown) => setError(errorCode(reason)))
        .finally(() => setBusy(false))
    },
    [target]
  )

  const actions: DesktopActions = {
    takeControl: () =>
      run<DesktopStatus>('desktop.control.set', { owner: 'user', viewerId }, setStatus),
    handBack: () =>
      run<DesktopStatus>('desktop.control.set', { owner: 'agent', viewerId }, setStatus),
    startRecording: () =>
      run('desktop.record.start', {}, () =>
        setStatus((current) => current && { ...current, recording: true })
      ),
    stopRecording: () =>
      run('desktop.record.stop', {}, () =>
        setStatus((current) => current && { ...current, recording: false })
      ),
    retry: () => {
      setStatus(null)
      setLost(false)
      setConnection((current) => current + 1)
      // Read now instead of waiting for the next poll; a new connection opens a new viewer.
      run<DesktopStatus>('desktop.status', {}, setStatus)
    }
  }

  return {
    view: desktopView(target, status, lost),
    connection,
    busy,
    error,
    actions,
    markLost: useCallback(() => setLost(true), [])
  }
}
