import { describe, expect, it } from 'vitest'
import { HeldInput } from './desktop-rfb-input'

function released(held: HeldInput): number[][] {
  const written: number[][] = []
  held.release({ width: 100, height: 100 }, (message) => written.push([...message]))
  return written
}

describe('HeldInput with noVNC extension input', () => {
  it('releases a key held through a QEMU extended key event', () => {
    const held = new HeldInput()
    // QEMUExtendedKeyEvent(down, keysym 0x61, keycode 0x1e)
    held.observe(Buffer.from([255, 0, 0, 1, 0, 0, 0, 0x61, 0, 0, 0, 0x1e]))

    expect(released(held)).toEqual([[4, 0, 0, 0, 0, 0, 0, 0x61]])
  })

  it('reads an extended pointer event mask without its marker bit', () => {
    const moved = new HeldInput()
    moved.observe(Buffer.from([5, 0x80, 0, 10, 0, 20, 0]))
    expect(released(moved)).toEqual([])

    const pressed = new HeldInput()
    // Button 8 (bit 7 of the full mask) arrives in the extra byte.
    pressed.observe(Buffer.from([5, 0x80, 0, 10, 0, 20, 1]))
    expect(released(pressed)).toEqual([[5, 0, 0, 10, 0, 20]])
  })
})
