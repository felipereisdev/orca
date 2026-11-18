import { RfbError } from './rfb-protocol'

export type RfbPixelFormat = {
  bitsPerPixel: number
  depth: number
  bigEndian: boolean
  trueColor: boolean
  redMax: number
  greenMax: number
  blueMax: number
  redShift: number
  greenShift: number
  blueShift: number
}

/** Xvnc's native 24-bit depth format: little-endian 32bpp, bytes B, G, R, X. */
export const DEFAULT_RFB_PIXEL_FORMAT: RfbPixelFormat = {
  bitsPerPixel: 32,
  depth: 24,
  bigEndian: false,
  trueColor: true,
  redMax: 255,
  greenMax: 255,
  blueMax: 255,
  redShift: 16,
  greenShift: 8,
  blueShift: 0
}

export function parseRfbPixelFormat(bytes: Buffer): RfbPixelFormat {
  if (bytes.length !== 16) {
    throw new RfbError('rfb_protocol_error')
  }
  return {
    bitsPerPixel: bytes[0],
    depth: bytes[1],
    bigEndian: bytes[2] !== 0,
    trueColor: bytes[3] !== 0,
    redMax: bytes.readUInt16BE(4),
    greenMax: bytes.readUInt16BE(6),
    blueMax: bytes.readUInt16BE(8),
    redShift: bytes[10],
    greenShift: bytes[11],
    blueShift: bytes[12]
  }
}

export function serializeRfbPixelFormat(format: RfbPixelFormat): Buffer {
  const bytes = Buffer.alloc(16)
  bytes[0] = format.bitsPerPixel
  bytes[1] = format.depth
  bytes[2] = format.bigEndian ? 1 : 0
  bytes[3] = format.trueColor ? 1 : 0
  bytes.writeUInt16BE(format.redMax, 4)
  bytes.writeUInt16BE(format.greenMax, 6)
  bytes.writeUInt16BE(format.blueMax, 8)
  bytes[10] = format.redShift
  bytes[11] = format.greenShift
  bytes[12] = format.blueShift
  return bytes
}

const BYTE_ALIGNED_SHIFTS = new Set([0, 8, 16, 24])

/** Only 32bpp true color with three independent 8-bit channels is decoded; the broker asks for it. */
export function assertRfbTrueColor32(format: RfbPixelFormat): void {
  const maxes = [format.redMax, format.greenMax, format.blueMax]
  const shifts = [format.redShift, format.greenShift, format.blueShift]
  if (
    format.bitsPerPixel !== 32 ||
    !format.trueColor ||
    maxes.some((max) => max !== 255) ||
    shifts.some((shift) => !BYTE_ALIGNED_SHIFTS.has(shift)) ||
    new Set(shifts).size !== shifts.length
  ) {
    throw new RfbError('rfb_unsupported_pixel_format')
  }
}

export function readRfbPixel(
  bytes: Buffer,
  offset: number,
  format: RfbPixelFormat
): [number, number, number] {
  const value = format.bigEndian ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset)
  return [
    (value >>> format.redShift) & 255,
    (value >>> format.greenShift) & 255,
    (value >>> format.blueShift) & 255
  ]
}

export function writeRfbPixel(
  bytes: Buffer,
  offset: number,
  format: RfbPixelFormat,
  [red, green, blue]: [number, number, number]
): void {
  const value =
    ((red << format.redShift) | (green << format.greenShift) | (blue << format.blueShift)) >>> 0
  if (format.bigEndian) {
    bytes.writeUInt32BE(value, offset)
  } else {
    bytes.writeUInt32LE(value, offset)
  }
}
