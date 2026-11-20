import { desEncryptBlock } from './des-block-cipher'
import { RfbError } from './rfb-protocol'

function reverseBits(byte: number): number {
  let reversed = 0
  for (let bit = 0; bit < 8; bit++) {
    reversed = (reversed << 1) | ((byte >> bit) & 1)
  }
  return reversed
}

/** VNC Authentication (RFC 6143 7.2.2): DES-ECB of the challenge, keyed by the bit-reversed password. */
export function vncAuthResponse(password: string, challenge: Buffer): Buffer {
  if (challenge.length !== 16) {
    throw new RfbError('rfb_protocol_error')
  }
  const key = Buffer.alloc(8)
  Buffer.from(password, 'utf8').copy(key, 0, 0, 8)
  for (let index = 0; index < key.length; index++) {
    key[index] = reverseBits(key[index])
  }
  return Buffer.concat([
    desEncryptBlock(key, challenge.subarray(0, 8)),
    desEncryptBlock(key, challenge.subarray(8, 16))
  ])
}
