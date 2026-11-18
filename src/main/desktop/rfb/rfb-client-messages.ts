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
 * Reassembles a client→server byte stream into whole RFB messages. Header bytes go into a small
 * fixed buffer; once a message's length is known its bytes are copied straight into one buffer of
 * that size, so memory stays bounded and no caller buffer is retained after `push` returns.
 */
export class RfbClientMessageFilter {
  private readonly header = Buffer.alloc(MAX_HEADER_BYTES)
  private headerFilled = 0
  private message: Buffer | null = null
  private messageFilled = 0

  push(chunk: Buffer): Buffer[] {
    const messages: Buffer[] = []
    let offset = 0
    while (offset < chunk.length) {
      if (this.message === null) {
        this.header[this.headerFilled++] = chunk[offset++]
        const length = messageLength(this.header.subarray(0, this.headerFilled))
        if (length === null) {
          continue
        }
        this.message = Buffer.allocUnsafe(length)
        this.messageFilled = this.header.copy(this.message, 0, 0, this.headerFilled)
        this.headerFilled = 0
      } else {
        const count = Math.min(this.message.length - this.messageFilled, chunk.length - offset)
        chunk.copy(this.message, this.messageFilled, offset, offset + count)
        this.messageFilled += count
        offset += count
      }
      if (this.messageFilled === this.message.length) {
        messages.push(this.message)
        this.message = null
      }
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
