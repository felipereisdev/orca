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

/** Reassembles a client→server byte stream into whole RFB messages. */
export class RfbClientMessageFilter {
  private pending: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): Buffer[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    const messages: Buffer[] = []
    for (;;) {
      const length = messageLength(this.pending)
      if (length === null || this.pending.length < length) {
        break
      }
      messages.push(Buffer.from(this.pending.subarray(0, length)))
      this.pending = this.pending.subarray(length)
    }
    if (this.pending.length > 0) {
      this.pending = Buffer.from(this.pending)
    }
    return messages
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
