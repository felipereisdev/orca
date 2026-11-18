import { describe, expect, it } from 'vitest'
import { RfbFramebuffer } from './rfb-framebuffer'

function rectHeader(x: number, y: number, w: number, h: number, encoding: number): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(x, 0)
  header.writeUInt16BE(y, 2)
  header.writeUInt16BE(w, 4)
  header.writeUInt16BE(h, 6)
  header.writeInt32BE(encoding, 8)
  return header
}

describe('RfbFramebuffer', () => {
  it('framebuffer applies a Raw rect and a DesktopSize resize', () => {
    const fb = new RfbFramebuffer(4, 2)
    // Default pixel format is 32bpp little-endian with red at bit 16: bytes are B, G, R, X.
    fb.apply(
      Buffer.concat([
        Buffer.from([0, 0, 0, 1]),
        rectHeader(1, 1, 2, 1, 0),
        Buffer.from([0x30, 0x20, 0x10, 0x00, 0x03, 0x02, 0x01, 0x00])
      ])
    )
    const pixels = fb.rgba()
    expect([...pixels.subarray(20, 28)]).toEqual([0x10, 0x20, 0x30, 255, 0x01, 0x02, 0x03, 255])
    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 255])

    const resizes: unknown[] = []
    fb.on('resize', (size) => resizes.push(size))
    fb.apply(Buffer.concat([Buffer.from([0, 0, 0, 1]), rectHeader(0, 0, 3, 5, -223)]))

    expect(resizes).toEqual([{ width: 3, height: 5 }])
    expect([fb.width, fb.height]).toEqual([3, 5])
    expect(fb.rgba()).toHaveLength(3 * 5 * 4)
  })

  it('rejects a Raw rect outside the framebuffer', () => {
    const fb = new RfbFramebuffer(2, 2)
    const update = Buffer.concat([
      Buffer.from([0, 0, 0, 1]),
      rectHeader(1, 0, 2, 1, 0),
      Buffer.alloc(8)
    ])
    expect(() => fb.apply(update)).toThrow(expect.objectContaining({ code: 'rfb_protocol_error' }))
  })
})
