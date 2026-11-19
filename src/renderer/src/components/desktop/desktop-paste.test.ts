import { expect, it } from 'vitest'
import { pasteIntoDesktop } from './desktop-paste'

it.each([
  {
    scenario: 'emoji and CJK paste sends Unicode keysyms without ClientCutText',
    text: 'é😀漢',
    expected: [
      [0xe9, true],
      [0xe9, false],
      [0x0101f600, true],
      [0x0101f600, false],
      [0x01006f22, true],
      [0x01006f22, false]
    ]
  },
  {
    scenario: 'Latin-1 paste sends ClientCutText before ctrl+v',
    text: 'Olá, coração',
    expected: ['Olá, coração', [0xffe3, true], [0x76, true], [0x76, false], [0xffe3, false]]
  }
])('$scenario', ({ text, expected }) => {
  const sent: (string | [number, boolean])[] = []
  pasteIntoDesktop(
    {
      clipboardPasteFrom: (clipboard) => sent.push(clipboard),
      sendKey: (keysym, _code, down) => sent.push([keysym, down])
    },
    text
  )
  expect(sent).toEqual(expected)
})
