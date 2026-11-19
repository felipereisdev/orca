import { useEffect, useEffectEvent, useRef } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { readDesktopControllerToken } from './desktop-controller-token'
import { createDesktopViewerChannel } from './desktop-viewer-channel'
import { isDesktopPasteShortcut, pasteIntoDesktop } from './desktop-paste'

/** What the tab can do with a mounted viewer. */
export type DesktopViewerControls = { paste: (text: string) => void }

type MountedViewer = DesktopViewerControls & {
  setViewOnly: (viewOnly: boolean) => void
  dispose: () => void
}

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
  let paste = (_text: string): void => {}
  const lost = (): void => {
    if (!disposed) {
      onLost()
    }
  }
  void Promise.all([import('@novnc/novnc'), readDesktopControllerToken(target)]).then(
    ([{ default: Rfb }, controllerToken]) => {
      if (disposed) {
        return
      }
      const rfb = new Rfb(
        container,
        createDesktopViewerChannel(target, viewerId, { controllerToken })
      )
      rfb.viewOnly = viewOnly
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.addEventListener('disconnect', lost)
      setViewOnly = (next) => {
        rfb.viewOnly = next
      }
      paste = (text) => pasteIntoDesktop(rfb, text)
      dispose = () => {
        rfb.removeEventListener('disconnect', lost)
        rfb.disconnect()
      }
    },
    lost
  )
  return {
    setViewOnly: (next) => setViewOnly(next),
    paste: (text) => paste(text),
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
  onLost,
  onPasteShortcut,
  controlsRef
}: {
  target: RuntimeClientTarget
  viewerId: string
  viewOnly: boolean
  onLost: () => void
  /** Cmd/Ctrl+V while this viewer holds control: the tab pastes the Mac's clipboard. */
  onPasteShortcut: () => void
  controlsRef: { current: DesktopViewerControls | null }
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
    controlsRef.current = viewer
    return () => {
      viewerRef.current = null
      if (controlsRef.current === viewer) {
        controlsRef.current = null
      }
      viewer.dispose()
    }
  }, [target, viewerId, controlsRef])

  const onKeyDownCapture = (event: React.KeyboardEvent): void => {
    // Captured before noVNC's canvas sees it, which would send the Mac's own chord to the guest.
    if (!viewOnly && isDesktopPasteShortcut(event, navigator.userAgent.includes('Mac'))) {
      event.preventDefault()
      event.stopPropagation()
      onPasteShortcut()
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-black"
      onKeyDownCapture={onKeyDownCapture}
    />
  )
}
