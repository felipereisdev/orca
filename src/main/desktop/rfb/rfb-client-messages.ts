import {
  RFB_CLIENT_CUT_TEXT,
  RFB_CLIENT_ENABLE_CONTINUOUS_UPDATES,
  RFB_CLIENT_FENCE,
  RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST,
  RFB_CLIENT_KEY_EVENT,
  RFB_CLIENT_POINTER_EVENT,
  RFB_CLIENT_SET_DESKTOP_SIZE,
  RFB_CLIENT_SET_ENCODINGS,
  RFB_CLIENT_SET_PIXEL_FORMAT,
  RFB_CLIENT_XVP,
  RFB_ENCODING_EXTENDED_CLIPBOARD,
  RFB_ENCODING_EXTENDED_MOUSE_BUTTONS,
  RFB_ENCODING_QEMU_EXTENDED_KEY_EVENT,
  RfbError
} from './rfb-protocol'

const FIXED_MESSAGE_LENGTHS = new Map<number, number>([
  [RFB_CLIENT_SET_PIXEL_FORMAT, 20],
  [RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST, 10],
  [RFB_CLIENT_KEY_EVENT, 8],
  [RFB_CLIENT_POINTER_EVENT, 6],
  [RFB_CLIENT_ENABLE_CONTINUOUS_UPDATES, 10],
  [RFB_CLIENT_XVP, 4]
])

// Messages that act on the desktop, so only the controlling viewer's reach it.
const INPUT_MESSAGE_TYPES = new Set([
  RFB_CLIENT_KEY_EVENT,
  RFB_CLIENT_POINTER_EVENT,
  RFB_CLIENT_CUT_TEXT,
  RFB_CLIENT_SET_DESKTOP_SIZE,
  RFB_CLIENT_XVP
])

/**
 * Pseudo-encodings a viewer may not negotiate: with them noVNC sends 7-byte pointer events and
 * keycode-tracked QEMU keys, which the filter would misframe and a handoff could not release.
 * With Extended Clipboard a paste only notifies and sends its text once the server asks, after
 * the ctrl+v that follows it; plain ClientCutText carries the text before it.
 */
const UNSUPPORTED_ENCODINGS = new Set([
  RFB_ENCODING_EXTENDED_MOUSE_BUTTONS,
  RFB_ENCODING_QEMU_EXTENDED_KEY_EVENT,
  RFB_ENCODING_EXTENDED_CLIPBOARD
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
  if (type === RFB_CLIENT_FENCE) {
    return buffer.length < 9 ? null : 9 + buffer[8]
  }
  if (type === RFB_CLIENT_SET_DESKTOP_SIZE) {
    return buffer.length < 7 ? null : 8 + 16 * buffer[6]
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

// messageLength never reads past the ClientCutText or ClientFence header.
const MAX_HEADER_BYTES = 9

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

/** Messages that act on the desktop: keys, pointer, clipboard, resizing and XVP power actions. */
export function isInputMessage(message: Buffer): boolean {
  return INPUT_MESSAGE_TYPES.has(message[0])
}

/** A SetEncodings without the unsupported pseudo-encodings; any other message is returned as is. */
export function withoutUnsupportedEncodings(message: Buffer): Buffer {
  if (message[0] !== RFB_CLIENT_SET_ENCODINGS) {
    return message
  }
  const encodings = Array.from({ length: message.readUInt16BE(2) }, (_, index) =>
    message.readInt32BE(4 + 4 * index)
  )
  const kept = encodings.filter((encoding) => !UNSUPPORTED_ENCODINGS.has(encoding))
  if (kept.length === encodings.length) {
    return message
  }
  const rewritten = Buffer.alloc(4 + 4 * kept.length)
  rewritten[0] = RFB_CLIENT_SET_ENCODINGS
  rewritten.writeUInt16BE(kept.length, 2)
  kept.forEach((encoding, index) => rewritten.writeInt32BE(encoding, 4 + 4 * index))
  return rewritten
}
