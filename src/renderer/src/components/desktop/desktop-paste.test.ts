import { expect, it } from 'vitest'
import { pasteIntoDesktop } from './desktop-paste'

const modifierKeyUps = [
  [0xffe3, false],
  [0xffe4, false],
  [0xffe1, false],
  [0xffe2, false],
  [0xffe9, false],
  [0xffea, false],
  [0xffe7, false],
  [0xffe8, false],
  [0xffeb, false],
  [0xffec, false]
]

it.each([
  {
    scenario: 'Unicode paste releases modifiers before typing any character',
    text: 'aé😀漢',
    expected: [
      [0x61, true],
      [0x61, false],
      [0xe9, true],
      [0xe9, false],
      [0x0101f600, true],
      [0x0101f600, false],
      [0x01006f22, true],
      [0x01006f22, false]
    ]
  },
  {
    scenario: 'Latin-1 paste releases modifiers and sends ClientCutText before ctrl+v',
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
  expect(sent).toEqual([...modifierKeyUps, ...expected])
})
