import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { HeldInput } from './desktop-rfb-input'
import { connectRfbUpstream, withSocketTimeout, type DesktopVncTarget } from './desktop-upstream'
import { isInputMessage, RfbClientMessageFilter } from './rfb/rfb-client-messages'
import { runRfbServerHandshake } from './rfb/rfb-server-handshake'

type ViewerHandlers = {
  /** Whether this viewer's input may reach the desktop right now (checked per message). */
  inputAllowed: () => boolean
  onClosed: () => void
}

/**
 * One downstream viewer bridged to its own upstream RFB connection. Server→viewer bytes pass
 * untouched; viewer→server messages are reassembled and input is dropped unless allowed.
 */
export class DesktopViewerSession {
  private readonly held = new HeldInput()
  private closed = false

  private constructor(
    private readonly downstream: Duplex,
    private readonly upstream: Socket,
    private readonly handlers: ViewerHandlers
  ) {}

  static async open(
    target: DesktopVncTarget,
    downstream: Duplex,
    handlers: ViewerHandlers
  ): Promise<DesktopViewerSession> {
    downstream.on('error', () => {})
    let upstream: Socket | undefined
    try {
      const connected = await connectRfbUpstream(target)
      upstream = connected.socket
      await withSocketTimeout(downstream, () =>
        runRfbServerHandshake(downstream, connected.init.serverInit)
      )
    } catch (error) {
      upstream?.destroy()
      downstream.destroy()
      throw error
    }
    const session = new DesktopViewerSession(downstream, upstream, handlers)
    session.relay()
    return session
  }

  /** Sends key-ups and a button-up for whatever this viewer holds; used when it loses control. */
  releaseHeld(): void {
    for (const message of this.held.releaseMessages()) {
      this.upstream.write(message)
    }
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
