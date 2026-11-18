import { describe, expect, it } from 'vitest'
import { keysymsFor, keysymsForText } from './desktop-keysyms'

describe('keysymsFor', () => {
  it('keysymsFor maps ctrl+shift+t and Return', () => {
    expect(keysymsFor('ctrl+shift+t')).toEqual([0xffe3, 0xffe1, 0x74])
    expect(keysymsFor('Return')).toEqual([0xff0d])
  })

  it('rejects an unknown key name with desktop_invalid_input', () => {
    expect(() => keysymsFor('ctrl+nosuchkey')).toThrow(
      expect.objectContaining({ code: 'desktop_invalid_input' })
    )
  })

  it('does not resolve inherited object properties as key names', () => {
    expect(() => keysymsFor('constructor')).toThrow(
      expect.objectContaining({ code: 'desktop_invalid_input' })
    )
  })
})

describe('keysymsForText', () => {
  it('maps Latin-1 directly, other code points to 0x01000000 + codepoint, and newlines to Return', () => {
    expect(keysymsForText('aÉ€\n')).toEqual([[0x61], [0xc9], [0x010020ac], [0xff0d]])
  })
})
