import { describe, expect, it } from 'vitest'
import { isInputMessage, RfbClientMessageFilter } from './rfb-client-messages'

// The exact bytes noVNC 1.7's RFB.messages encoders write (core/rfb.js), one of each.
const NOVNC = {
  // clientFence(sock, 3, 'ab'): type, 3 pad, flags u32, length u8, payload
  clientFence: Buffer.from([248, 0, 0, 0, 0, 0, 0, 3, 2, 0x61, 0x62]),
  // enableContinuousUpdates(sock, true, 0, 0, 640, 480)
  enableContinuousUpdates: Buffer.from([150, 1, 0, 0, 0, 0, 2, 0x80, 1, 0xe0]),
  // setDesktopSize(sock, 800, 600, 7, 0): one screen of 16 bytes
  setDesktopSize: Buffer.from([
    251, 0, 3, 0x20, 2, 0x58, 1, 0, 0, 0, 0, 7, 0, 0, 0, 0, 3, 0x20, 2, 0x58, 0, 0, 0, 0
  ]),
  // QEMUExtendedKeyEvent(sock, 0x61, 1, 0x1e)
  qemuKey: Buffer.from([255, 0, 0, 1, 0, 0, 0, 0x61, 0, 0, 0, 0x1e]),
  // xvpOp(sock, 1, 2)
  xvp: Buffer.from([250, 0, 1, 2]),
  // extendedPointerEvent(sock, 10, 20, 1 << 7): marker bit set, one extra byte of buttons
  extendedPointer: Buffer.from([5, 0x80, 0, 10, 0, 20, 1])
}

describe('RfbClientMessageFilter', () => {
  it('splits coalesced and partial chunks', () => {
    const setEncodings = Buffer.from([2, 0, 0, 3, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x21, 0, 0, 0, 1])
    const pointer = Buffer.from([5, 1, 0, 10, 0, 20])
    const stream = Buffer.concat([setEncodings, pointer])
    const filter = new RfbClientMessageFilter()

    expect(filter.push(stream.subarray(0, 3))).toEqual([])
    expect(filter.push(stream.subarray(3, 18))).toEqual([setEncodings])
    expect(filter.push(stream.subarray(18))).toEqual([pointer])
  })

  it('waits for the whole ClientCutText payload', () => {
    const cut = Buffer.concat([Buffer.from([6, 0, 0, 0, 0, 0, 0, 5]), Buffer.from('hello')])
    const filter = new RfbClientMessageFilter()

    expect(filter.push(cut.subarray(0, 10))).toEqual([])
    expect(filter.push(cut.subarray(10))).toEqual([cut])
  })

  it('assembles a fragmented 4 MiB ClientCutText without keeping caller buffers', () => {
    const text = Buffer.alloc(4 * 1024 * 1024)
    for (let index = 0; index < text.length; index++) {
      text[index] = (index * 31) & 255
    }
    const header = Buffer.from([6, 0, 0, 0, 0, 0, 0, 0])
    header.writeUInt32BE(text.length, 4)
    const cut = Buffer.concat([header, text])
    const pointer = Buffer.from([5, 1, 0, 10, 0, 20])
    const stream = Buffer.concat([cut, pointer])
    const fragmentSizes = [1, 3, 64 * 1024, 7, 1000, 40 * 1024, 1, 64 * 1024]
    const filter = new RfbClientMessageFilter()
    const messages: Buffer[] = []
    for (let offset = 0, index = 0; offset < stream.length; index++) {
      const size = fragmentSizes[index % fragmentSizes.length]
      const fragment = Buffer.from(stream.subarray(offset, offset + size))
      messages.push(...filter.push(fragment))
      fragment.fill(0xee)
      offset += size
    }

    expect(messages).toHaveLength(2)
    expect(messages[0].equals(cut)).toBe(true)
    expect(messages[1]).toEqual(pointer)
  })

  it('throws rfb_protocol_error on an unknown message type', () => {
    expect(() => new RfbClientMessageFilter().push(Buffer.from([99, 0, 0, 0]))).toThrow(
      expect.objectContaining({ code: 'rfb_protocol_error' })
    )
  })

  it('frames the extension messages noVNC 1.7 sends, split byte by byte', () => {
    const stream = Buffer.concat(Object.values(NOVNC))
    const filter = new RfbClientMessageFilter()
    const messages = [...stream].flatMap((byte) => filter.push(Buffer.from([byte])))

    expect(messages).toEqual(Object.values(NOVNC))
  })

  it('rejects a QEMU client message other than the extended key event', () => {
    expect(() => new RfbClientMessageFilter().push(Buffer.from([255, 1, 0, 0]))).toThrow(
      expect.objectContaining({ code: 'rfb_protocol_error' })
    )
  })
})

describe('isInputMessage', () => {
  it('is true for key, pointer and cut text', () => {
    expect(isInputMessage(Buffer.from([4, 1, 0, 0, 0, 0, 0xff, 0x0d]))).toBe(true)
    expect(isInputMessage(Buffer.from([5, 0, 0, 1, 0, 1]))).toBe(true)
    expect(isInputMessage(Buffer.from([6, 0, 0, 0, 0, 0, 0, 0]))).toBe(true)
    expect(isInputMessage(Buffer.alloc(20))).toBe(false)
    expect(isInputMessage(Buffer.from([2, 0, 0, 0]))).toBe(false)
    expect(isInputMessage(Buffer.from([3, 1, 0, 0, 0, 0, 0, 8, 0, 8]))).toBe(false)
  })

  it('treats resize, QEMU keys, XVP and extended pointer as input, fence and CU as not', () => {
    expect(isInputMessage(NOVNC.setDesktopSize)).toBe(true)
    expect(isInputMessage(NOVNC.qemuKey)).toBe(true)
    expect(isInputMessage(NOVNC.xvp)).toBe(true)
    expect(isInputMessage(NOVNC.extendedPointer)).toBe(true)
    expect(isInputMessage(NOVNC.clientFence)).toBe(false)
    expect(isInputMessage(NOVNC.enableContinuousUpdates)).toBe(false)
  })
})
