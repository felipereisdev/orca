import type { Duplex } from 'node:stream'
import { DesktopError } from './desktop-errors'
import type { DesktopBounds } from './desktop-rfb-input'
import { desktopFailureReason, type DesktopVncTarget } from './desktop-upstream'
import { DesktopViewerSession } from './desktop-viewer-session'

type ViewerRegistryHooks = {
  /** Whether the viewer with this id holds control. */
  inControl: (viewerId: string) => boolean
  /** The desktop size the server last announced, if known; releases are clamped into it. */
  bounds: () => DesktopBounds | undefined
  /** A viewer finished connecting and is now registered. */
  onRegistered: (viewerId: string) => void
  /** A registered viewer closed. */
  onClosed: (viewerId: string) => void
}

/**
 * Viewer sessions by id, including those still connecting: a newer open or `close` cancels a
 * pending attempt, and only a registered session counts as present.
 */
export class DesktopViewerRegistry {
  readonly #sessions = new Map<string, DesktopViewerSession>()
  readonly #pending = new Map<string, AbortController>()

  constructor(private readonly hooks: ViewerRegistryHooks) {}

  has(viewerId: string): boolean {
    return this.#sessions.has(viewerId)
  }

  get(viewerId: string): DesktopViewerSession | undefined {
    return this.#sessions.get(viewerId)
  }

  /** `stillCurrent` is false once the broker was reconfigured during the attempt. */
  async open(
    target: DesktopVncTarget,
    viewerId: string,
    downstream: Duplex,
    stillCurrent: () => boolean
  ): Promise<void> {
    this.close(viewerId)
    const attempt = new AbortController()
    this.#pending.set(viewerId, attempt)
    let session: DesktopViewerSession | undefined
    try {
      session = await DesktopViewerSession.open(
        target,
        downstream,
        {
          inputAllowed: () =>
            this.hooks.inControl(viewerId) && this.#sessions.get(viewerId) === session,
          bounds: this.hooks.bounds,
          onClosed: () => {
            if (this.#sessions.get(viewerId) === session) {
              this.#sessions.delete(viewerId)
              this.hooks.onClosed(viewerId)
            }
          }
        },
        attempt.signal
      )
    } catch (error) {
      throw new DesktopError(
        'desktop_unavailable',
        attempt.signal.aborted ? 'desktop_viewer_cancelled' : desktopFailureReason(error)
      )
    } finally {
      if (this.#pending.get(viewerId) === attempt) {
        this.#pending.delete(viewerId)
      }
    }
    if (attempt.signal.aborted || !stillCurrent()) {
      session.close()
      throw new DesktopError('desktop_unavailable', 'desktop_viewer_cancelled')
    }
    this.#sessions.set(viewerId, session)
    this.hooks.onRegistered(viewerId)
  }

  close(viewerId: string): void {
    this.#pending.get(viewerId)?.abort()
    this.#pending.delete(viewerId)
    this.#sessions.get(viewerId)?.close()
  }

  /** Every announced size reaches each session now, so it outlives the control connection. */
  announceBounds(bounds: DesktopBounds): void {
    for (const session of this.#sessions.values()) {
      session.updateBounds(bounds)
    }
  }

  closeAll(): void {
    for (const viewerId of new Set([...this.#pending.keys(), ...this.#sessions.keys()])) {
      this.close(viewerId)
    }
  }
}
