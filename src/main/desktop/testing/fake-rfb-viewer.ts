import { duplexPair, type Duplex } from 'node:stream'
import {
  RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST,
  RFB_CLIENT_KEY_EVENT,
  RFB_CLIENT_POINTER_EVENT,
  RFB_CLIENT_SET_ENCODINGS,
  RFB_ENCODING_RAW,
  RFB_PROTOCOL_VERSION,
  RFB_SECURITY_NONE,
  RfbError
} from '../rfb/rfb-protocol'
import { readExact, readRfbString } from '../rfb/rfb-stream-reader'

export type FakeRfbViewerRect = {
  x: number
  y: number
  width: number
  height: number
  encoding: number
}

/** The viewer end of a broker viewer session: a minimal RFB 3.8 client with security None. */
export type FakeRfbViewer = {
  socket: Duplex
  width: number
  height: number
  pointer(x: number, y: number, buttonMask: number): void
  key(down: boolean, keysym: number): void
  setEncodings(encodings: number[]): void
  requestUpdate(incremental: boolean, width: number, height: number): void
  /** Reads one FramebufferUpdate (Raw at 32bpp, or pseudo-encodings without payload). */
  readUpdate(): Promise<FakeRfbViewerRect[]>
}

async function viewerHandshake(socket: Duplex): Promise<{ width: number; height: number }> {
  await readExact(socket, 12)
  socket.write(RFB_PROTOCOL_VERSION)
  const types = await readExact(socket, (await readExact(socket, 1))[0])
  if (!types.includes(RFB_SECURITY_NONE)) {
    throw new RfbError('rfb_unsupported_security')
  }
  socket.write(Buffer.from([RFB_SECURITY_NONE]))
  if ((await readExact(socket, 4)).readUInt32BE(0) !== 0) {
    throw new RfbError('rfb_auth_failed')
  }
  socket.write(Buffer.from([1]))
  const head = await readExact(socket, 20)
  await readRfbString(socket)
  return { width: head.readUInt16BE(0), height: head.readUInt16BE(2) }
}

/** Opens a viewer on `open` (e.g. `broker.openViewer`) and completes the downstream handshake. */
export async function connectFakeRfbViewer(
  open: (downstream: Duplex) => Promise<void>
): Promise<FakeRfbViewer> {
  const [brokerSide, socket] = duplexPair()
  const opening = open(brokerSide)
  const size = await viewerHandshake(socket)
  await opening
  return {
    socket,
    ...size,
    pointer(x, y, buttonMask) {
      const message = Buffer.alloc(6)
      message[0] = RFB_CLIENT_POINTER_EVENT
      message[1] = buttonMask
      message.writeUInt16BE(x, 2)
      message.writeUInt16BE(y, 4)
      socket.write(message)
    },
    key(down, keysym) {
      const message = Buffer.alloc(8)
      message[0] = RFB_CLIENT_KEY_EVENT
      message[1] = down ? 1 : 0
      message.writeUInt32BE(keysym, 4)
      socket.write(message)
    },
    setEncodings(encodings) {
      const message = Buffer.alloc(4 + encodings.length * 4)
      message[0] = RFB_CLIENT_SET_ENCODINGS
      message.writeUInt16BE(encodings.length, 2)
      encodings.forEach((encoding, index) => message.writeInt32BE(encoding, 4 + index * 4))
      socket.write(message)
    },
    requestUpdate(incremental, width, height) {
      const message = Buffer.alloc(10)
      message[0] = RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST
      message[1] = incremental ? 1 : 0
      message.writeUInt16BE(width, 6)
      message.writeUInt16BE(height, 8)
      socket.write(message)
    },
    async readUpdate() {
      const header = await readExact(socket, 4)
      const rects: FakeRfbViewerRect[] = []
      for (let index = 0; index < header.readUInt16BE(2); index++) {
        const rect = await readExact(socket, 12)
        const parsed = {
          x: rect.readUInt16BE(0),
          y: rect.readUInt16BE(2),
          width: rect.readUInt16BE(4),
          height: rect.readUInt16BE(6),
          encoding: rect.readInt32BE(8)
        }
        if (parsed.encoding === RFB_ENCODING_RAW) {
          await readExact(socket, parsed.width * parsed.height * 4)
        }
        rects.push(parsed)
      }
      return rects
    }
  }
}
