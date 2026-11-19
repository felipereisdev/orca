import { useCallback, useEffect, useRef, useState } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  pollDesktopStatus,
  type DesktopStatus,
  type DesktopStatusPoller
} from './desktop-status-poller'

/** Who holds the desktop as this viewer sees it: the agent, this viewer, or another window. */
export type DesktopControl = 'agent' | 'this' | 'other'

export type DesktopView =
  | { kind: 'connecting' }
  | { kind: 'unavailable' }
  | { kind: 'unconfigured' }
  | { kind: 'ready'; control: DesktopControl; recording: boolean }

export type DesktopActions = {
  takeControl: () => void
  handBack: () => void
  startRecording: () => void
  stopRecording: () => void
  retry: () => void
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown'
}

function control(status: DesktopStatus): DesktopControl {
  if (status.viewerControl === 'this') {
    return 'this'
  }
  // A user owner this viewer cannot place is someone else's, so this one stays view-only.
  return status.viewerControl === 'other' || status.owner === 'user' ? 'other' : 'agent'
}

export function desktopView(
  target: RuntimeClientTarget | null,
  status: DesktopStatus | null,
  lost: boolean
): DesktopView {
  if (!target || target.kind !== 'environment' || lost || status?.state === 'unavailable') {
    return { kind: 'unavailable' }
  }
  if (status?.state === 'unconfigured') {
    return { kind: 'unconfigured' }
  }
  if (status?.state !== 'ready') {
    return { kind: 'connecting' }
  }
  return { kind: 'ready', control: control(status), recording: status.recording }
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
  // Why a failed status read is unavailable: its RPC code, shown until a read succeeds.
  const [statusError, setStatusError] = useState<string | null>(null)
  const pollerRef = useRef<DesktopStatusPoller | null>(null)

  useEffect(() => {
    if (!target || target.kind !== 'environment') {
      return
    }
    const poller = pollDesktopStatus(
      target,
      viewerId,
      (next) => {
        setStatus(next)
        setStatusError(null)
        // A desktop that went down and came back gets a fresh viewer without a retry.
        if (next.state !== 'ready') {
          setLost(false)
        }
      },
      (reason) => {
        setLost(true)
        setStatusError(errorCode(reason))
      }
    )
    pollerRef.current = poller
    return () => {
      pollerRef.current = null
      poller.stop()
    }
  }, [target, viewerId])

  const mutate = useCallback(
    <T>(method: string, params: unknown, apply: (result: T) => void): void => {
      if (!target) {
        return
      }
      setBusy(true)
      setError(null)
      // Reads begun before or during this action may predate it, so their answers are dropped.
      const mutation = pollerRef.current?.beginMutation()
      callRuntimeRpc<T>(target, method, params)
        .then(apply, (reason: unknown) => setError(errorCode(reason)))
        .finally(() => {
          setBusy(false)
          mutation?.settled()
        })
    },
    [target]
  )

  const setControl = (owner: 'agent' | 'user'): void =>
    mutate<DesktopStatus>('desktop.control.set', { owner, viewerId }, (next) =>
      setStatus({ ...next, viewerControl: owner === 'user' ? 'this' : null })
    )

  const actions: DesktopActions = {
    takeControl: () => setControl('user'),
    handBack: () => setControl('agent'),
    startRecording: () =>
      mutate('desktop.record.start', {}, () =>
        setStatus((current) => current && { ...current, recording: true })
      ),
    stopRecording: () =>
      mutate('desktop.record.stop', {}, () =>
        setStatus((current) => current && { ...current, recording: false })
      ),
    retry: () => {
      setStatus(null)
      setLost(false)
      setError(null)
      // A new connection opens a new viewer; read now instead of waiting for the next poll.
      setConnection((current) => current + 1)
      pollerRef.current?.refresh()
    }
  }

  return {
    view: desktopView(target, status, lost),
    connection,
    busy,
    error: error ?? statusError,
    actions,
    markLost: useCallback(() => setLost(true), [])
  }
}
