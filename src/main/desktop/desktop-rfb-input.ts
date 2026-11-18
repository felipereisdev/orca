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

  /** Key-ups (latest first) and a button-up for everything held; clears the record. */
  releaseMessages(): Buffer[] {
    const messages = [...this.keys].toReversed().map((keysym) => keyEventMessage(false, keysym))
    if (this.buttonMask !== 0) {
      messages.push(pointerEventMessage(0, this.x, this.y))
    }
    this.keys.clear()
    this.buttonMask = 0
    return messages
  }
}
