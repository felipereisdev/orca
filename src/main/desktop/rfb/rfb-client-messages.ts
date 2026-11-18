import {
  RFB_CLIENT_CUT_TEXT,
  RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST,
  RFB_CLIENT_KEY_EVENT,
  RFB_CLIENT_POINTER_EVENT,
  RFB_CLIENT_SET_ENCODINGS,
  RFB_CLIENT_SET_PIXEL_FORMAT,
  RfbError
} from './rfb-protocol'

const FIXED_MESSAGE_LENGTHS = new Map<number, number>([
  [RFB_CLIENT_SET_PIXEL_FORMAT, 20],
  [RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST, 10],
  [RFB_CLIENT_KEY_EVENT, 8],
  [RFB_CLIENT_POINTER_EVENT, 6]
])

// Bounds how much a viewer can make us buffer before a cut-text message completes.
const MAX_CUT_TEXT_BYTES = 16 * 1024 * 1024

/** Total length of the message at the start of `buffer`, or null while its header is incomplete. */
function messageLength(buffer: Buffer): number | null {
  if (buffer.length === 0) {
    return null
  }
  const type = buffer[0]
  const fixed = FIXED_MESSAGE_LENGTHS.get(type)
  if (fixed !== undefined) {
    return fixed
  }
  if (type === RFB_CLIENT_SET_ENCODINGS) {
    return buffer.length < 4 ? null : 4 + 4 * buffer.readUInt16BE(2)
  }
  if (type === RFB_CLIENT_CUT_TEXT) {
    if (buffer.length < 8) {
      return null
    }
    // A negative length is the Extended Clipboard form; its payload is |length| bytes.
    const length = Math.abs(buffer.readInt32BE(4))
    if (length > MAX_CUT_TEXT_BYTES) {
      throw new RfbError('rfb_protocol_error')
    }
    return 8 + length
  }
  throw new RfbError('rfb_protocol_error')
}

// messageLength never reads past the ClientCutText header.
const MAX_HEADER_BYTES = 8

/**
 * Reassembles a client→server byte stream into whole RFB messages. Fragments are kept as a list
 * and each complete message is copied once, so a large fragmented message costs linear work.
 */
export class RfbClientMessageFilter {
  private chunks: Buffer[] = []
  private pendingBytes = 0
  private nextLength: number | null = null

  push(chunk: Buffer): Buffer[] {
    if (chunk.length > 0) {
      this.chunks.push(chunk)
      this.pendingBytes += chunk.length
    }
    const messages: Buffer[] = []
    for (;;) {
      this.nextLength ??= messageLength(this.peek(Math.min(MAX_HEADER_BYTES, this.pendingBytes)))
      if (this.nextLength === null || this.pendingBytes < this.nextLength) {
        break
      }
      messages.push(this.take(this.nextLength))
      this.nextLength = null
    }
    return messages
  }

  private peek(length: number): Buffer {
    const first = this.chunks[0]
    if (first === undefined || first.length >= length) {
      return first?.subarray(0, length) ?? Buffer.alloc(0)
    }
    const header = Buffer.alloc(length)
    let filled = 0
    for (const chunk of this.chunks) {
      if (filled === length) {
        break
      }
      filled += chunk.copy(header, filled, 0, Math.min(chunk.length, length - filled))
    }
    return header
  }

  private take(length: number): Buffer {
    const message = Buffer.allocUnsafe(length)
    let filled = 0
    let consumed = 0
    while (filled < length) {
      const chunk = this.chunks[consumed]
      const count = Math.min(chunk.length, length - filled)
      chunk.copy(message, filled, 0, count)
      filled += count
      if (count === chunk.length) {
        consumed++
      } else {
        this.chunks[consumed] = chunk.subarray(count)
      }
    }
    this.chunks.splice(0, consumed)
    this.pendingBytes -= length
    return message
  }
}

/** Messages that act on the desktop: key, pointer and clipboard. */
export function isInputMessage(message: Buffer): boolean {
  const type = message[0]
  return (
    type === RFB_CLIENT_KEY_EVENT ||
    type === RFB_CLIENT_POINTER_EVENT ||
    type === RFB_CLIENT_CUT_TEXT
  )
}
