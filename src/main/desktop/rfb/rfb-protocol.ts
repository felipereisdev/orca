export const RFB_PROTOCOL_VERSION = 'RFB 003.008\n'

export const RFB_SECURITY_NONE = 1
export const RFB_SECURITY_VNC_AUTH = 2

export const RFB_ENCODING_RAW = 0
export const RFB_ENCODING_DESKTOP_SIZE = -223

export const RFB_SERVER_FRAMEBUFFER_UPDATE = 0

export const RFB_CLIENT_SET_PIXEL_FORMAT = 0
export const RFB_CLIENT_SET_ENCODINGS = 2
export const RFB_CLIENT_FRAMEBUFFER_UPDATE_REQUEST = 3
export const RFB_CLIENT_KEY_EVENT = 4
export const RFB_CLIENT_POINTER_EVENT = 5
export const RFB_CLIENT_CUT_TEXT = 6

export type RfbErrorCode =
  | 'rfb_auth_failed'
  | 'rfb_unsupported_security'
  | 'rfb_protocol_error'
  | 'rfb_connection_closed'

/** The message is only the code; `detail` holds what the server said, never credentials. */
export class RfbError extends Error {
  readonly code: RfbErrorCode
  readonly detail?: string

  constructor(code: RfbErrorCode, detail?: string) {
    super(code)
    this.name = 'RfbError'
    this.code = code
    this.detail = detail
  }
}

export function rfbUint32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value, 0)
  return buffer
}

/** u32 length + bytes, as used for reasons and desktop names. */
export function rfbString(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  return Buffer.concat([rfbUint32(bytes.length), bytes])
}
