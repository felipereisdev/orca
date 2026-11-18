import { RFB_CLIENT_KEY_EVENT, RFB_CLIENT_POINTER_EVENT } from './rfb/rfb-protocol'

export function keyEventMessage(down: boolean, keysym: number): Buffer {
  const message = Buffer.alloc(8)
  message[0] = RFB_CLIENT_KEY_EVENT
  message[1] = down ? 1 : 0
  message.writeUInt32BE(keysym >>> 0, 4)
  return message
}

export function pointerEventMessage(buttonMask: number, x: number, y: number): Buffer {
  const message = Buffer.alloc(6)
  message[0] = RFB_CLIENT_POINTER_EVENT
  message[1] = buttonMask
  message.writeUInt16BE(x, 2)
  message.writeUInt16BE(y, 4)
  return message
}

export type DesktopBounds = { width: number; height: number }

/** `x`, `y` moved into 0..width-1, 0..height-1, so a release is never dropped as out of bounds. */
export function clampedPointer(
  x: number,
  y: number,
  bounds: DesktopBounds
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, bounds.width - 1)),
    y: Math.max(0, Math.min(y, bounds.height - 1))
  }
}

/**
 * Keys and mouse buttons one input source currently holds down, learned from the messages it
 * sent, so control can be handed over without leaving anything stuck.
 */
export class HeldInput {
  private readonly keys = new Set<number>()
  private buttonMask = 0
  private x = 0
  private y = 0

  observe(message: Buffer): void {
    if (message[0] === RFB_CLIENT_KEY_EVENT) {
      const keysym = message.readUInt32BE(4)
      if (message[1] !== 0) {
        this.keys.add(keysym)
      } else {
        this.keys.delete(keysym)
      }
    } else if (message[0] === RFB_CLIENT_POINTER_EVENT) {
      this.buttonMask = message[1]
      this.x = message.readUInt16BE(2)
      this.y = message.readUInt16BE(4)
    }
  }

  /**
   * Writes key-ups (latest first) and a button-up for everything held, then clears the record.
   * The button-up goes to the last point clamped into `bounds` (the size the server announced
   * now), since the desktop may have shrunk under the held pointer; at (0, 0) when unknown.
   */
  release(bounds: DesktopBounds | undefined, write: (message: Buffer) => void): void {
    for (const keysym of [...this.keys].toReversed()) {
      write(keyEventMessage(false, keysym))
    }
    if (this.buttonMask !== 0) {
      // With no known size, (0, 0) is the only point always inside the desktop.
      const { x, y } = clampedPointer(this.x, this.y, bounds ?? { width: 1, height: 1 })
      write(pointerEventMessage(0, x, y))
    }
    this.keys.clear()
    this.buttonMask = 0
  }
}
