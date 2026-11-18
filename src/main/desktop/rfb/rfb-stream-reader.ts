import type { Duplex } from 'node:stream'
import { RfbError } from './rfb-protocol'

const MAX_RFB_STRING_BYTES = 64 * 1024

/**
 * Reads exactly `length` bytes, leaving anything after them buffered in the stream so the next
 * reader (or a later 'data' listener) receives it.
 */
export function readExact(socket: Duplex, length: number): Promise<Buffer> {
  if (length === 0) {
    return Promise.resolve(Buffer.alloc(0))
  }
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      socket.off('readable', onReadable)
      socket.off('end', onClosed)
      socket.off('close', onClosed)
      socket.off('error', onError)
    }
    const onClosed = (): void => {
      cleanup()
      reject(new RfbError('rfb_connection_closed'))
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onReadable = (): void => {
      const chunk: Buffer | null = socket.read(length)
      if (chunk === null) {
        return
      }
      cleanup()
      if (chunk.length < length) {
        reject(new RfbError('rfb_connection_closed'))
        return
      }
      resolve(chunk)
    }
    if (socket.destroyed || socket.readableEnded) {
      reject(new RfbError('rfb_connection_closed'))
      return
    }
    socket.on('readable', onReadable)
    socket.once('end', onClosed)
    socket.once('close', onClosed)
    socket.once('error', onError)
    onReadable()
  })
}

/** Reads a u32-length-prefixed UTF-8 string (reason or desktop name). */
export async function readRfbString(socket: Duplex): Promise<{ raw: Buffer; text: string }> {
  const header = await readExact(socket, 4)
  const length = header.readUInt32BE(0)
  if (length > MAX_RFB_STRING_BYTES) {
    throw new RfbError('rfb_protocol_error')
  }
  const body = await readExact(socket, length)
  return { raw: Buffer.concat([header, body]), text: body.toString('utf8') }
}
