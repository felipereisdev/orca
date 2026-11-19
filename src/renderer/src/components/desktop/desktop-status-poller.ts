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
  /** For the viewer that asked: it holds control (`this`), another viewer does, or nobody. */
  viewerControl?: 'this' | 'other' | null
}

export type DesktopStatusPoller = {
  /** Reads now; a read already in flight is ignored when it lands. */
  refresh: () => void
  /** Call before and after a mutation: reads that started earlier are ignored when they land. */
  invalidate: () => void
  stop: () => void
}

const STATUS_POLL_MS = 3_000

/**
 * Polls `desktop.status` for one viewer. Each read records the epoch it started in and is dropped
 * if the epoch moved, so a late read cannot undo an acknowledged action or a newer read.
 */
export function pollDesktopStatus(
  target: RuntimeClientTarget,
  viewerId: string,
  onStatus: (status: DesktopStatus) => void,
  onFailure: () => void
): DesktopStatusPoller {
  let active = true
  let epoch = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const poll = async (): Promise<void> => {
    const started = ++epoch
    clearTimeout(timer)
    try {
      const next = await callRuntimeRpc<DesktopStatus>(target, 'desktop.status', { viewerId })
      if (active && started === epoch) {
        onStatus(next)
      }
    } catch {
      if (active && started === epoch) {
        onFailure()
      }
    }
    if (active && started === epoch) {
      timer = setTimeout(() => void poll(), STATUS_POLL_MS)
    }
  }
  void poll()
  return {
    refresh: () => {
      if (active) {
        void poll()
      }
    },
    invalidate: () => {
      epoch++
      // The superseded read no longer reschedules; keep polling from here.
      clearTimeout(timer)
      if (active) {
        timer = setTimeout(() => void poll(), STATUS_POLL_MS)
      }
    },
    stop: () => {
      active = false
      clearTimeout(timer)
    }
  }
}
