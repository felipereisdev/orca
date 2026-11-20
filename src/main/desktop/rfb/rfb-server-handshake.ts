import type { Duplex } from 'node:stream'
import { RFB_PROTOCOL_VERSION, RFB_SECURITY_NONE, RfbError, rfbUint32 } from './rfb-protocol'
import { readExact } from './rfb-stream-reader'

/**
 * Server side of RFB 3.8 towards a downstream viewer, with security None: the viewer is already
 * authenticated by the Orca connection, so only the broker ever holds the VNC password.
 */
export async function runRfbServerHandshake(socket: Duplex, serverInit: Buffer): Promise<void> {
  socket.write(RFB_PROTOCOL_VERSION)
  if ((await readExact(socket, 12)).toString('latin1') !== RFB_PROTOCOL_VERSION) {
    throw new RfbError('rfb_protocol_error')
  }
  socket.write(Buffer.from([1, RFB_SECURITY_NONE]))
  if ((await readExact(socket, 1))[0] !== RFB_SECURITY_NONE) {
    throw new RfbError('rfb_unsupported_security')
  }
  socket.write(rfbUint32(0))
  // ClientInit's shared flag is ignored: the broker's upstream session is always shared.
  await readExact(socket, 1)
  socket.write(serverInit)
}
