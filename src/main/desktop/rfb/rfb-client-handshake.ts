import type { Duplex } from 'node:stream'
import { RFB_PROTOCOL_VERSION, RFB_SECURITY_VNC_AUTH, RfbError } from './rfb-protocol'
import { readExact, readRfbString } from './rfb-stream-reader'
import { vncAuthResponse } from './vnc-auth'

export type RfbServerInit = {
  /** The whole ServerInit message, replayed to downstream viewers. */
  serverInit: Buffer
  width: number
  height: number
  pixelFormat: Buffer
  name: string
}

function assertServerSpeaksRfb38(version: string): void {
  const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(version)
  if (!match) {
    throw new RfbError('rfb_protocol_error')
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major < 3 || (major === 3 && minor < 8)) {
    throw new RfbError('rfb_protocol_error')
  }
}

async function readOptionalReason(socket: Duplex): Promise<string | undefined> {
  try {
    return (await readRfbString(socket)).text
  } catch {
    return undefined
  }
}

/** Client side of RFB 3.8 with VNC Authentication, up to and including ServerInit. */
export async function performRfbClientHandshake(
  socket: Duplex,
  opts: { password: string; shared: true }
): Promise<RfbServerInit> {
  assertServerSpeaksRfb38((await readExact(socket, 12)).toString('latin1'))
  socket.write(RFB_PROTOCOL_VERSION)

  const typeCount = (await readExact(socket, 1))[0]
  if (typeCount === 0) {
    throw new RfbError('rfb_protocol_error', await readOptionalReason(socket))
  }
  const types = await readExact(socket, typeCount)
  if (!types.includes(RFB_SECURITY_VNC_AUTH)) {
    throw new RfbError('rfb_unsupported_security')
  }
  socket.write(Buffer.from([RFB_SECURITY_VNC_AUTH]))
  const challenge = await readExact(socket, 16)
  socket.write(vncAuthResponse(opts.password, challenge))
  if ((await readExact(socket, 4)).readUInt32BE(0) !== 0) {
    throw new RfbError('rfb_auth_failed', await readOptionalReason(socket))
  }

  socket.write(Buffer.from([opts.shared ? 1 : 0]))
  const head = await readExact(socket, 20)
  const name = await readRfbString(socket)
  return {
    serverInit: Buffer.concat([head, name.raw]),
    width: head.readUInt16BE(0),
    height: head.readUInt16BE(2),
    pixelFormat: Buffer.from(head.subarray(4, 20)),
    name: name.text
  }
}
