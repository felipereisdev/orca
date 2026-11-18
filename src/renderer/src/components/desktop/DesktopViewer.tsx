import { useEffect, useEffectEvent, useRef } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { createDesktopViewerChannel } from './desktop-viewer-channel'

type MountedViewer = { setViewOnly: (viewOnly: boolean) => void; dispose: () => void }

/** Opens noVNC on `container` once it loads (on first open, so it stays out of the initial bundle). */
function mountDesktopViewer(
  container: HTMLElement,
  target: RuntimeClientTarget,
  viewerId: string,
  initialViewOnly: boolean,
  onLost: () => void
): MountedViewer {
  let disposed = false
  let viewOnly = initialViewOnly
  let dispose = (): void => {}
  let setViewOnly = (next: boolean): void => {
    viewOnly = next
  }
  const lost = (): void => {
    if (!disposed) {
      onLost()
    }
  }
  void import('@novnc/novnc').then(({ default: Rfb }) => {
    if (disposed) {
      return
    }
    const rfb = new Rfb(container, createDesktopViewerChannel(target, viewerId))
    rfb.viewOnly = viewOnly
    rfb.scaleViewport = true
    rfb.resizeSession = false
    rfb.addEventListener('disconnect', lost)
    setViewOnly = (next) => {
      rfb.viewOnly = next
    }
    dispose = () => {
      rfb.removeEventListener('disconnect', lost)
      rfb.disconnect()
    }
  }, lost)
  return {
    setViewOnly: (next) => setViewOnly(next),
    dispose: () => {
      disposed = true
      dispose()
    }
  }
}

/** A live noVNC view of the environment desktop; input reaches it only while `viewOnly` is off. */
export function DesktopViewer({
  target,
  viewerId,
  viewOnly,
  onLost
}: {
  target: RuntimeClientTarget
  viewerId: string
  viewOnly: boolean
  onLost: () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<MountedViewer | null>(null)
  const viewOnlyRef = useRef(viewOnly)
  const lost = useEffectEvent(onLost)

  useEffect(() => {
    viewOnlyRef.current = viewOnly
    viewerRef.current?.setViewOnly(viewOnly)
  }, [viewOnly])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const viewer = mountDesktopViewer(container, target, viewerId, viewOnlyRef.current, () =>
      lost()
    )
    viewerRef.current = viewer
    return () => {
      viewerRef.current = null
      viewer.dispose()
    }
  }, [target, viewerId])

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-black" />
}
