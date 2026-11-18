import { randomBytes } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { RfbClientMessageFilter } from '../rfb/rfb-client-messages'
import {
  assertRfbTrueColor32,
  DEFAULT_RFB_PIXEL_FORMAT,
  parseRfbPixelFormat,
  serializeRfbPixelFormat,
  writeRfbPixel,
  type RfbPixelFormat
} from '../rfb/rfb-pixel-format'
import {
  RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST,
  RFB_CLIENT_SET_ENCODINGS,
  RFB_CLIENT_SET_PIXEL_FORMAT,
  RFB_ENCODING_DESKTOP_SIZE,
  RFB_ENCODING_RAW,
  RFB_PROTOCOL_VERSION,
  RFB_SECURITY_VNC_AUTH,
  RFB_SERVER_FRAMEBUFFER_UPDATE,
  rfbString,
  rfbUint32
} from '../rfb/rfb-protocol'
import { readExact } from '../rfb/rfb-stream-reader'
import { vncAuthResponse } from '../rfb/vnc-auth'

export type FakeRfbServer = {
  port: number
  /** Every client→server message after ClientInit, from all connections, in arrival order. */
  received: Buffer[]
  /** Resolves once `received` satisfies `predicate`; event-driven, so tests never poll. */
  waitForReceived(predicate: (received: Buffer[]) => boolean): Promise<void>
  /** Holds back pixel replies to non-incremental requests until `releaseUpdates`. */
  holdUpdates(): void
  releaseUpdates(): void
  /**
   * Changes the desktop size. Clients that advertised DesktopSize get the new size in reply to
   * their outstanding (or next) FramebufferUpdateRequest, as a real server does.
   */
  setSize(width: number, height: number): void
  close(): Promise<void>
}

type FakeRfbSession = {
  socket: Socket
  format: RfbPixelFormat
  encodings: Set<number>
  /** An incremental request with nothing to send yet; answered by the next change. */
  incrementalPending: boolean
  resizePending: boolean
}

const FAKE_DESKTOP_NAME = 'Orca fake desktop'

type Rect = { x: number; y: number; width: number; height: number }

function updateHeader(rectCount: number): Buffer {
  const header = Buffer.alloc(4)
  header[0] = RFB_SERVER_FRAMEBUFFER_UPDATE
  header.writeUInt16BE(rectCount, 2)
  return header
}

function rectHeader(rect: Rect, encoding: number): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(rect.x, 0)
  header.writeUInt16BE(rect.y, 2)
  header.writeUInt16BE(rect.width, 4)
  header.writeUInt16BE(rect.height, 6)
  header.writeInt32BE(encoding, 8)
  return header
}

// Deterministic pattern so screenshot tests can check pixels: red = x, green = y, blue = 0x80.
function rawRect(rect: Rect, format: RfbPixelFormat): Buffer {
  const pixels = Buffer.alloc(rect.width * rect.height * 4)
  let offset = 0
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      writeRfbPixel(pixels, offset, format, [x & 255, y & 255, 0x80])
      offset += 4
    }
  }
  return Buffer.concat([updateHeader(1), rectHeader(rect, RFB_ENCODING_RAW), pixels])
}

/** In-process RFB 3.8 server with VNC Authentication, for broker and handshake tests. */
export async function startFakeRfbServer(opts: {
  password: string
  width: number
  height: number
  /** Listen on this port instead of an ephemeral one (to bring a server back on the same port). */
  port?: number
}): Promise<FakeRfbServer> {
  let width = opts.width
  let height = opts.height
  const received: Buffer[] = []
  const waiters = new Set<{ predicate: (received: Buffer[]) => boolean; resolve: () => void }>()
  const sockets = new Set<Socket>()
  const sessions = new Set<FakeRfbSession>()
  let heldReplies: (() => void)[] | null = null

  const record = (message: Buffer): void => {
    received.push(message)
    for (const waiter of waiters) {
      if (waiter.predicate(received)) {
        waiters.delete(waiter)
        waiter.resolve()
      }
    }
  }

  const sendDesktopSize = (session: FakeRfbSession): void => {
    session.resizePending = false
    session.socket.write(
      Buffer.concat([
        updateHeader(1),
        rectHeader({ x: 0, y: 0, width, height }, RFB_ENCODING_DESKTOP_SIZE)
      ])
    )
  }

  const answerUpdateRequest = (session: FakeRfbSession, message: Buffer): void => {
    if (session.resizePending) {
      sendDesktopSize(session)
      return
    }
    if (message[1] !== 0) {
      session.incrementalPending = true
      return
    }
    session.incrementalPending = false
    const x = Math.min(message.readUInt16BE(2), width)
    const y = Math.min(message.readUInt16BE(4), height)
    const rect = {
      x,
      y,
      width: Math.min(message.readUInt16BE(6), width - x),
      height: Math.min(message.readUInt16BE(8), height - y)
    }
    const reply =
      rect.width > 0 && rect.height > 0 ? rawRect(rect, session.format) : updateHeader(0)
    if (heldReplies) {
      heldReplies.push(() => session.socket.write(reply))
    } else {
      session.socket.write(reply)
    }
  }

  const handleMessage = (session: FakeRfbSession, message: Buffer): void => {
    if (message[0] === RFB_CLIENT_SET_PIXEL_FORMAT) {
      const format = parseRfbPixelFormat(message.subarray(4, 20))
      assertRfbTrueColor32(format)
      session.format = format
    } else if (message[0] === RFB_CLIENT_SET_ENCODINGS) {
      session.encodings = new Set(
        Array.from({ length: message.readUInt16BE(2) }, (_, i) => message.readInt32BE(4 + i * 4))
      )
    } else if (message[0] === RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST) {
      answerUpdateRequest(session, message)
    }
  }

  const serve = async (socket: Socket): Promise<void> => {
    socket.write(RFB_PROTOCOL_VERSION)
    if ((await readExact(socket, 12)).toString('latin1') !== RFB_PROTOCOL_VERSION) {
      socket.destroy()
      return
    }
    socket.write(Buffer.from([1, RFB_SECURITY_VNC_AUTH]))
    if ((await readExact(socket, 1))[0] !== RFB_SECURITY_VNC_AUTH) {
      socket.end(Buffer.concat([rfbUint32(1), rfbString('Security type not offered')]))
      return
    }
    const challenge = randomBytes(16)
    socket.write(challenge)
    const response = await readExact(socket, 16)
    if (!response.equals(vncAuthResponse(opts.password, challenge))) {
      socket.end(Buffer.concat([rfbUint32(1), rfbString('Authentication failure')]))
      return
    }
    socket.write(rfbUint32(0))
    await readExact(socket, 1)
    const sizes = Buffer.alloc(4)
    sizes.writeUInt16BE(width, 0)
    sizes.writeUInt16BE(height, 2)
    socket.write(
      Buffer.concat([
        sizes,
        serializeRfbPixelFormat(DEFAULT_RFB_PIXEL_FORMAT),
        rfbString(FAKE_DESKTOP_NAME)
      ])
    )
    const session: FakeRfbSession = {
      socket,
      format: DEFAULT_RFB_PIXEL_FORMAT,
      encodings: new Set(),
      incrementalPending: false,
      resizePending: false
    }
    sessions.add(session)
    socket.once('close', () => sessions.delete(session))
    const filter = new RfbClientMessageFilter()
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const message of filter.push(chunk)) {
          record(message)
          handleMessage(session, message)
        }
      } catch {
        socket.destroy()
      }
    })
  }

  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    serve(socket).catch(() => socket.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('fake RFB server has no TCP address')
  }

  return {
    port: address.port,
    received,
    waitForReceived: (predicate) =>
      predicate(received)
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.add({ predicate, resolve })),
    holdUpdates() {
      heldReplies ??= []
    },
    releaseUpdates() {
      const replies = heldReplies ?? []
      heldReplies = null
      for (const reply of replies) {
        reply()
      }
    },
    setSize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      for (const session of sessions) {
        if (!session.encodings.has(RFB_ENCODING_DESKTOP_SIZE)) {
          continue
        }
        session.resizePending = true
        if (session.incrementalPending) {
          session.incrementalPending = false
          sendDesktopSize(session)
        }
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      })
  }
}
