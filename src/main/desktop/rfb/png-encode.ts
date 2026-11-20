import { promisify } from 'node:util'
import { crc32, deflate } from 'node:zlib'

const deflateAsync = promisify(deflate)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_FILTER_NONE = 0

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const chunk = Buffer.alloc(8 + data.length + 4)
  chunk.writeUInt32BE(data.length, 0)
  typeAndData.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(typeAndData), 8 + data.length)
  return chunk
}

/** Encodes 8-bit RGBA pixels as a PNG; deflate runs on the libuv pool, off the event loop. */
export async function encodePng(width: number, height: number, rgba: Buffer): Promise<Buffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('PNG dimensions must be positive integers')
  }
  const stride = width * 4
  if (rgba.length !== stride * height) {
    throw new Error('RGBA buffer does not match the PNG dimensions')
  }
  const scanlines = Buffer.alloc((stride + 1) * height)
  for (let row = 0; row < height; row++) {
    scanlines[row * (stride + 1)] = PNG_FILTER_NONE
    rgba.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // color type RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', await deflateAsync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
