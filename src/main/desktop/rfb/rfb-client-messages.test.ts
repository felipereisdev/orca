import { describe, expect, it } from 'vitest'
import { isInputMessage, RfbClientMessageFilter } from './rfb-client-messages'

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

  it('throws rfb_protocol_error on an unknown message type', () => {
    expect(() => new RfbClientMessageFilter().push(Buffer.from([250, 0, 0, 0]))).toThrow(
      expect.objectContaining({ code: 'rfb_protocol_error' })
    )
  })
})

describe('isInputMessage', () => {
  it('is true for key, pointer and cut text only', () => {
    expect(isInputMessage(Buffer.from([4, 1, 0, 0, 0, 0, 0xff, 0x0d]))).toBe(true)
    expect(isInputMessage(Buffer.from([5, 0, 0, 1, 0, 1]))).toBe(true)
    expect(isInputMessage(Buffer.from([6, 0, 0, 0, 0, 0, 0, 0]))).toBe(true)
    expect(isInputMessage(Buffer.alloc(20))).toBe(false)
    expect(isInputMessage(Buffer.from([2, 0, 0, 0]))).toBe(false)
    expect(isInputMessage(Buffer.from([3, 1, 0, 0, 0, 0, 0, 8, 0, 8]))).toBe(false)
  })
})
