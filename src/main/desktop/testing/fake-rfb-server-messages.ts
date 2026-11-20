/** Server→client messages the fake VNC server sends as TigerVNC does. */
const RFB_SERVER_FENCE = 248
const RFB_FENCE_REQUEST = 0x8000_0000
const RFB_FENCE_BLOCK_BEFORE = 1

// TigerVNC's Extended Clipboard Caps: text, with caps, request, peek, notify and provide.
const EXTENDED_CLIPBOARD_CAPS_FLAGS = 0x1f000001

/** A ServerCutText whose negative length marks the Extended Clipboard form. */
export function extendedClipboardCaps(): Buffer {
  const message = Buffer.alloc(16)
  message[0] = 3
  message.writeInt32BE(-8, 4)
  message.writeUInt32BE(EXTENDED_CLIPBOARD_CAPS_FLAGS, 8)
  message.writeUInt32BE(1024 * 1024, 12)
  return message
}

export function serverFence(payload: string): Buffer {
  const header = Buffer.alloc(9)
  header[0] = RFB_SERVER_FENCE
  header.writeUInt32BE((RFB_FENCE_REQUEST | RFB_FENCE_BLOCK_BEFORE) >>> 0, 4)
  header[8] = Buffer.byteLength(payload, 'latin1')
  return Buffer.concat([header, Buffer.from(payload, 'latin1')])
}
