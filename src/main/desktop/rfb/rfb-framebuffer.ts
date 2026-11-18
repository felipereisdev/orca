import { EventEmitter } from 'node:events'
import {
  assertRfbTrueColor32,
  DEFAULT_RFB_PIXEL_FORMAT,
  parseRfbPixelFormat,
  readRfbPixel,
  type RfbPixelFormat
} from './rfb-pixel-format'
import {
  RFB_ENCODING_DESKTOP_SIZE,
  RFB_ENCODING_RAW,
  RFB_SERVER_FRAMEBUFFER_UPDATE,
  RfbError
} from './rfb-protocol'

export type RfbFramebufferSize = { width: number; height: number }

const RECT_HEADER_BYTES = 12
// Peer-supplied sizes are bounded so a bad ServerInit or DesktopSize cannot exhaust main memory.
const MAX_FRAMEBUFFER_SIDE = 8192
const MAX_FRAMEBUFFER_PIXELS = 33_554_432

export function assertRfbFramebufferSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RfbError('rfb_protocol_error')
  }
  if (
    width > MAX_FRAMEBUFFER_SIDE ||
    height > MAX_FRAMEBUFFER_SIDE ||
    width * height > MAX_FRAMEBUFFER_PIXELS
  ) {
    throw new RfbError('rfb_framebuffer_too_large')
  }
}

function blankPixels(width: number, height: number): Buffer {
  assertRfbFramebufferSize(width, height)
  const pixels = Buffer.alloc(width * height * 4)
  for (let offset = 3; offset < pixels.length; offset += 4) {
    pixels[offset] = 255
  }
  return pixels
}

/** Mirrors the server desktop from FramebufferUpdate messages (Raw and DesktopSize, 32bpp true color). */
export class RfbFramebuffer extends EventEmitter<{ resize: [RfbFramebufferSize] }> {
  private pixels: Buffer
  private readonly format: RfbPixelFormat
  private currentWidth: number
  private currentHeight: number

  constructor(width: number, height: number, pixelFormat?: Buffer) {
    super()
    this.format = pixelFormat ? parseRfbPixelFormat(pixelFormat) : DEFAULT_RFB_PIXEL_FORMAT
    assertRfbTrueColor32(this.format)
    this.pixels = blankPixels(width, height)
    this.currentWidth = width
    this.currentHeight = height
  }

  get width(): number {
    return this.currentWidth
  }

  get height(): number {
    return this.currentHeight
  }

  /** A copy of the desktop as 8-bit RGBA rows. */
  rgba(): Buffer {
    return Buffer.from(this.pixels)
  }

  /** Applies one whole FramebufferUpdate message. */
  apply(update: Buffer): void {
    if (update.length < 4 || update[0] !== RFB_SERVER_FRAMEBUFFER_UPDATE) {
      throw new RfbError('rfb_protocol_error')
    }
    const rectCount = update.readUInt16BE(2)
    let offset = 4
    for (let index = 0; index < rectCount; index++) {
      if (offset + RECT_HEADER_BYTES > update.length) {
        throw new RfbError('rfb_protocol_error')
      }
      const x = update.readUInt16BE(offset)
      const y = update.readUInt16BE(offset + 2)
      const width = update.readUInt16BE(offset + 4)
      const height = update.readUInt16BE(offset + 6)
      const encoding = update.readInt32BE(offset + 8)
      offset += RECT_HEADER_BYTES
      if (encoding === RFB_ENCODING_RAW) {
        offset = this.applyRaw(update, offset, { x, y, width, height })
      } else if (encoding === RFB_ENCODING_DESKTOP_SIZE) {
        this.resize(width, height)
      } else {
        throw new RfbError('rfb_protocol_error')
      }
    }
    if (offset !== update.length) {
      throw new RfbError('rfb_protocol_error')
    }
  }

  private applyRaw(
    update: Buffer,
    offset: number,
    rect: { x: number; y: number; width: number; height: number }
  ): number {
    const end = offset + rect.width * rect.height * 4
    if (
      end > update.length ||
      rect.x + rect.width > this.currentWidth ||
      rect.y + rect.height > this.currentHeight
    ) {
      throw new RfbError('rfb_protocol_error')
    }
    let source = offset
    for (let row = 0; row < rect.height; row++) {
      let target = ((rect.y + row) * this.currentWidth + rect.x) * 4
      for (let column = 0; column < rect.width; column++) {
        const [red, green, blue] = readRfbPixel(update, source, this.format)
        this.pixels[target] = red
        this.pixels[target + 1] = green
        this.pixels[target + 2] = blue
        this.pixels[target + 3] = 255
        source += 4
        target += 4
      }
    }
    return end
  }

  private resize(width: number, height: number): void {
    // Allocate (and budget-check) before committing the new size.
    this.pixels = blankPixels(width, height)
    this.currentWidth = width
    this.currentHeight = height
    this.emit('resize', { width, height })
  }
}
