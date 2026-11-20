import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodePng } from './png-encode'

function readChunks(png: Buffer): Map<string, Buffer> {
  const chunks = new Map<string, Buffer>()
  let offset = 8
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    chunks.set(type, Buffer.concat([chunks.get(type) ?? Buffer.alloc(0), data]))
    offset += 12 + length
  }
  return chunks
}

describe('encodePng', () => {
  it('encodePng output starts with the PNG signature and decodes to the same pixels', async () => {
    const rgba = Buffer.from([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    ])

    const png = await encodePng(3, 2, rgba)

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    const chunks = readChunks(png)
    expect(chunks.get('IHDR')).toEqual(Buffer.from([0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]))
    expect(chunks.has('IEND')).toBe(true)
    const scanlines = inflateSync(chunks.get('IDAT') ?? Buffer.alloc(0))
    expect(scanlines).toEqual(
      Buffer.concat([Buffer.from([0]), rgba.subarray(0, 12), Buffer.from([0]), rgba.subarray(12)])
    )
  })
})
