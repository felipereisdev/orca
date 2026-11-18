import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { HeldInput, type DesktopBounds } from './desktop-rfb-input'
import { connectRfbUpstream, withSocketTimeout, type DesktopVncTarget } from './desktop-upstream'
import { isInputMessage, RfbClientMessageFilter } from './rfb/rfb-client-messages'
import { runRfbServerHandshake } from './rfb/rfb-server-handshake'

type ViewerHandlers = {
  /** Whether this viewer's input may reach the desktop right now (checked per message). */
  inputAllowed: () => boolean
  /** The desktop size the server last announced, if known; releases are clamped into it. */
  bounds: () => DesktopBounds | undefined
  onClosed: () => void
}

/**
 * One downstream viewer bridged to its own upstream RFB connection. Server→viewer bytes pass
 * untouched; viewer→server messages are reassembled and input is dropped unless allowed.
 */
export class DesktopViewerSession {
  private readonly held = new HeldInput()
  /** The best size known for this desktop: ServerInit, then the broker's announced size. */
  private knownBounds: DesktopBounds
  private closed = false

  private constructor(
    private readonly downstream: Duplex,
    private readonly upstream: Socket,
    private readonly handlers: ViewerHandlers,
    initialBounds: DesktopBounds
  ) {
    this.knownBounds = initialBounds
  }

  /** `signal` cancels a session that is still connecting (closed or superseded viewer). */
  static async open(
    target: DesktopVncTarget,
    downstream: Duplex,
    handlers: ViewerHandlers,
    signal: AbortSignal
  ): Promise<DesktopViewerSession> {
    downstream.on('error', () => {})
    let upstream: Socket | undefined
    let bounds: DesktopBounds | undefined
    const onAbort = (): void => {
      upstream?.destroy()
      downstream.destroy()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const connected = await connectRfbUpstream(target, undefined, signal)
      upstream = connected.socket
      bounds = { width: connected.init.width, height: connected.init.height }
      signal.throwIfAborted()
      await withSocketTimeout(downstream, () =>
        runRfbServerHandshake(downstream, connected.init.serverInit)
      )
      signal.throwIfAborted()
    } catch (error) {
      upstream?.destroy()
      downstream.destroy()
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    const session = new DesktopViewerSession(downstream, upstream, handlers, bounds)
    session.relay()
    return session
  }

  /** Sends key-ups and a button-up (inside the desktop) for whatever this viewer holds. */
  releaseHeld(): void {
    this.held.release(this.currentBounds(), (message) => this.upstream.write(message))
  }

  /** The broker's announced size when it has one, else the last size this session knew. */
  private currentBounds(): DesktopBounds {
    const announced = this.handlers.bounds()
    if (announced) {
      this.knownBounds = announced
    }
    return this.knownBounds
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    // Held only records input that reached the desktop, so releasing it is always safe.
    this.releaseHeld()
    this.upstream.end()
    this.downstream.destroy()
    this.handlers.onClosed()
  }

  private relay(): void {
    const filter = new RfbClientMessageFilter()
    this.upstream.pipe(this.downstream)
    this.downstream.on('data', (chunk: Buffer) => {
      let messages: Buffer[]
      try {
        messages = filter.push(chunk)
      } catch {
        this.close()
        return
      }
      let flushed = true
      for (const message of messages) {
        if (!isInputMessage(message)) {
          flushed = this.upstream.write(message)
        } else if (this.handlers.inputAllowed()) {
          this.currentBounds() // remember the latest announced size while it is known
          this.held.observe(message)
          flushed = this.upstream.write(message)
        }
      }
      if (!flushed) {
        this.downstream.pause()
        this.upstream.once('drain', () => this.downstream.resume())
      }
    })
    for (const stream of [this.downstream, this.upstream]) {
      stream.once('end', () => this.close())
      stream.once('close', () => this.close())
    }
  }
}
