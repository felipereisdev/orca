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

  it('rejects zero dimensions', () => {
    expect(() => new RfbFramebuffer(0, 5)).toThrow(
      expect.objectContaining({ code: 'rfb_protocol_error' })
    )
    const fb = new RfbFramebuffer(2, 2)
    expect(() =>
      fb.apply(Buffer.concat([Buffer.from([0, 0, 0, 1]), rectHeader(0, 0, 4, 0, -223)]))
    ).toThrow(expect.objectContaining({ code: 'rfb_protocol_error' }))
    expect([fb.width, fb.height]).toEqual([2, 2])
  })

  it('rejects a framebuffer over 8192 per side or 33,554,432 pixels', () => {
    expect(() => new RfbFramebuffer(8193, 1)).toThrow(
      expect.objectContaining({ code: 'rfb_framebuffer_too_large' })
    )
    expect(() => new RfbFramebuffer(8192, 4097)).toThrow(
      expect.objectContaining({ code: 'rfb_framebuffer_too_large' })
    )
  })

  it('keeps the old size and pixels when a DesktopSize is over budget', () => {
    const fb = new RfbFramebuffer(1, 1)
    fb.apply(
      Buffer.concat([
        Buffer.from([0, 0, 0, 1]),
        rectHeader(0, 0, 1, 1, 0),
        Buffer.from([0x30, 0x20, 0x10, 0x00])
      ])
    )
    const resizes: unknown[] = []
    fb.on('resize', (size) => resizes.push(size))

    expect(() =>
      fb.apply(Buffer.concat([Buffer.from([0, 0, 0, 1]), rectHeader(0, 0, 65535, 65535, -223)]))
    ).toThrow(expect.objectContaining({ code: 'rfb_framebuffer_too_large' }))

    expect([fb.width, fb.height]).toEqual([1, 1])
    expect([...fb.rgba()]).toEqual([0x10, 0x20, 0x30, 255])
    expect(resizes).toEqual([])
  })

  it('rejects a pixel format other than 32bpp true color with 8-bit channels', () => {
    const sixteenBit = Buffer.from([16, 16, 0, 1, 0, 31, 0, 63, 0, 31, 11, 5, 0, 0, 0, 0])
    expect(() => new RfbFramebuffer(2, 2, sixteenBit)).toThrow(
      expect.objectContaining({ code: 'rfb_unsupported_pixel_format' })
    )
  })
})
