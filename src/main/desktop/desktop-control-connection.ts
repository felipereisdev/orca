import type { Socket } from 'node:net'
import { connectRfbUpstream, desktopFailureReason, type DesktopVncTarget } from './desktop-upstream'
import { HeldInput } from './desktop-rfb-input'
import type { RfbServerInit } from './rfb/rfb-client-handshake'
import { RfbFramebuffer } from './rfb/rfb-framebuffer'
import { DEFAULT_RFB_PIXEL_FORMAT, serializeRfbPixelFormat } from './rfb/rfb-pixel-format'
import {
  RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST,
  RFB_CLIENT_SET_ENCODINGS,
  RFB_CLIENT_SET_PIXEL_FORMAT,
  RFB_ENCODING_DESKTOP_SIZE,
  RFB_ENCODING_RAW,
  RFB_SERVER_FRAMEBUFFER_UPDATE,
  RfbError
} from './rfb/rfb-protocol'
import { readExact } from './rfb/rfb-stream-reader'

const RFB_SERVER_SET_COLOUR_MAP_ENTRIES = 1
const RFB_SERVER_BELL = 2
const RFB_SERVER_CUT_TEXT = 3
const MAX_SERVER_CUT_TEXT_BYTES = 16 * 1024 * 1024

function setPixelFormatMessage(): Buffer {
  const message = Buffer.alloc(20)
  message[0] = RFB_CLIENT_SET_PIXEL_FORMAT
  serializeRfbPixelFormat(DEFAULT_RFB_PIXEL_FORMAT).copy(message, 4)
  return message
}

function setEncodingsMessage(encodings: number[]): Buffer {
  const message = Buffer.alloc(4 + encodings.length * 4)
  message[0] = RFB_CLIENT_SET_ENCODINGS
  message.writeUInt16BE(encodings.length, 2)
  encodings.forEach((encoding, index) => message.writeInt32BE(encoding, 4 + index * 4))
  return message
}

function updateRequestMessage(incremental: boolean, width: number, height: number): Buffer {
  const message = Buffer.alloc(10)
  message[0] = RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST
  message[1] = incremental ? 1 : 0
  message.writeUInt16BE(width, 6)
  message.writeUInt16BE(height, 8)
  return message
}

function singleRectUpdate(rectHeader: Buffer, payload?: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header[0] = RFB_SERVER_FRAMEBUFFER_UPDATE
  header.writeUInt16BE(1, 2)
  return Buffer.concat(payload ? [header, rectHeader, payload] : [header, rectHeader])
}

/** A complete desktop image, copied when published; each `rgba()` call returns its own copy. */
export type DesktopFrame = {
  readonly width: number
  readonly height: number
  rgba(): Buffer
}

function snapshotFrame(framebuffer: RfbFramebuffer): DesktopFrame {
  const pixels = framebuffer.rgba()
  const { width, height } = framebuffer
  return { width, height, rgba: () => Buffer.from(pixels) }
}

type ControlHandlers = {
  onFrame: (frame: DesktopFrame) => void
  /** Called once if the connection drops on its own (not after `close()`). */
  onLost: (reason: string) => void
}

/**
 * The broker's own RFB connection: it mirrors the desktop into a framebuffer (screenshots,
 * recording) and carries the agent's input.
 */
export class DesktopControlConnection {
  /** Mirrors the server as updates arrive; may be mid-update or blank after a resize. */
  private readonly framebuffer: RfbFramebuffer
  /** What the agent holds down on this connection. */
  readonly held = new HeldInput()
  private published: DesktopFrame | undefined
  /** Raw pixels received since the last DesktopSize; a frame is published once they cover it. */
  private coveredSinceResize: number | null = 0
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  private constructor(
    private readonly socket: Socket,
    init: RfbServerInit,
    private readonly handlers: ControlHandlers
  ) {
    // Built for the format requested below; every update after SetPixelFormat uses it.
    this.framebuffer = new RfbFramebuffer(init.width, init.height)
  }

  /** Resolves once the first full frame arrived (inside the handshake timeout). */
  static async open(
    target: DesktopVncTarget,
    handlers: ControlHandlers,
    signal: AbortSignal
  ): Promise<DesktopControlConnection> {
    let connection: DesktopControlConnection | undefined
    await connectRfbUpstream(
      target,
      async (socket, init) => {
        connection = new DesktopControlConnection(socket, init, handlers)
        await connection.start()
      },
      signal
    )
    if (!connection) {
      throw new RfbError('rfb_connection_closed')
    }
    void connection.readForever()
    return connection
  }

  /** The latest complete frame; set before `open` resolves. */
  get frame(): DesktopFrame {
    if (!this.published) {
      throw new RfbError('rfb_protocol_error')
    }
    return this.published
  }

  /** The size the server last announced, which may be ahead of `frame` during a resize. */
  get desktopSize(): { width: number; height: number } {
    return { width: this.framebuffer.width, height: this.framebuffer.height }
  }

  /** Runs agent commands one after another, so they never interleave on the input stream. */
  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => undefined)
    return result
  }

  get writable(): boolean {
    return !this.closed && this.socket.writable
  }

  write(message: Buffer): void {
    this.held.observe(message)
    this.socket.write(message)
  }

  /** Writes without recording it as held input (releases on handover). */
  writeRelease(messages: Buffer[]): void {
    for (const message of messages) {
      this.socket.write(message)
    }
  }

  close(): void {
    this.closed = true
    this.socket.destroy()
  }

  private async start(): Promise<void> {
    this.socket.write(setPixelFormatMessage())
    this.socket.write(setEncodingsMessage([RFB_ENCODING_RAW, RFB_ENCODING_DESKTOP_SIZE]))
    this.requestFull()
    do {
      await this.readUntilUpdate()
    } while (!this.published)
  }

  private async readForever(): Promise<void> {
    try {
      for (;;) {
        await this.readUntilUpdate()
      }
    } catch (error) {
      this.lost(desktopFailureReason(error))
    }
  }

  private lost(reason: string): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.socket.destroy()
    this.handlers.onLost(reason)
  }

  private requestFull(): void {
    const { width, height } = this.framebuffer
    this.socket.write(updateRequestMessage(false, width, height))
  }

  // Until the pixels since the last resize cover the frame, keep asking for the full image; a
  // non-incremental request is answered with the whole screen, so an area count is enough.
  private afterUpdate(): void {
    const { width, height } = this.framebuffer
    if (this.coveredSinceResize !== null && this.coveredSinceResize >= width * height) {
      this.coveredSinceResize = null
    }
    if (this.coveredSinceResize === null) {
      this.publish()
    }
    if (this.closed) {
      return
    }
    this.socket.write(updateRequestMessage(this.coveredSinceResize === null, width, height))
  }

  /** Reads server messages until one FramebufferUpdate is applied, then requests the next. */
  private async readUntilUpdate(): Promise<void> {
    for (;;) {
      const type = (await readExact(this.socket, 1))[0]
      if (type === RFB_SERVER_FRAMEBUFFER_UPDATE) {
        await this.readFramebufferUpdate()
        this.afterUpdate()
        return
      }
      if (type === RFB_SERVER_SET_COLOUR_MAP_ENTRIES) {
        const header = await readExact(this.socket, 5)
        await readExact(this.socket, header.readUInt16BE(3) * 6)
      } else if (type === RFB_SERVER_CUT_TEXT) {
        const length = (await readExact(this.socket, 7)).readUInt32BE(3)
        if (length > MAX_SERVER_CUT_TEXT_BYTES) {
          throw new RfbError('rfb_protocol_error')
        }
        await readExact(this.socket, length)
      } else if (type !== RFB_SERVER_BELL) {
        throw new RfbError('rfb_protocol_error')
      }
    }
  }

  // Rects are applied one at a time so a DesktopSize mid-update bounds the Raw rects after it,
  // and a Raw rect is checked against the framebuffer before its payload is read.
  private async readFramebufferUpdate(): Promise<void> {
    const rectCount = (await readExact(this.socket, 3)).readUInt16BE(1)
    for (let index = 0; index < rectCount; index++) {
      const rect = await readExact(this.socket, 12)
      const encoding = rect.readInt32BE(8)
      if (encoding === RFB_ENCODING_DESKTOP_SIZE) {
        this.framebuffer.apply(singleRectUpdate(rect))
        this.coveredSinceResize = 0
        continue
      }
      const [x, y, width, height] = [0, 2, 4, 6].map((offset) => rect.readUInt16BE(offset))
      if (
        encoding !== RFB_ENCODING_RAW ||
        x + width > this.framebuffer.width ||
        y + height > this.framebuffer.height
      ) {
        throw new RfbError('rfb_protocol_error')
      }
      this.framebuffer.apply(
        singleRectUpdate(rect, await readExact(this.socket, width * height * 4))
      )
      if (this.coveredSinceResize !== null) {
        this.coveredSinceResize += width * height
      }
    }
  }

  private publish(): void {
    this.published = snapshotFrame(this.framebuffer)
    try {
      this.handlers.onFrame(this.published)
    } catch {
      // A failing frame consumer (e.g. a recorder) must not tear down the VNC session.
    }
  }
}
