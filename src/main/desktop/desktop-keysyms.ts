import { DesktopError } from './desktop-errors'

const MODIFIER_KEYSYMS = new Map<string, number>([
  ['ctrl', 0xffe3],
  ['control', 0xffe3],
  ['shift', 0xffe1],
  ['alt', 0xffe9],
  ['meta', 0xffeb],
  ['super', 0xffeb],
  ['cmd', 0xffeb],
  ['win', 0xffeb]
])

const NAMED_KEYSYMS = new Map<string, number>([
  ['return', 0xff0d],
  ['enter', 0xff0d],
  ['tab', 0xff09],
  ['escape', 0xff1b],
  ['esc', 0xff1b],
  ['backspace', 0xff08],
  ['delete', 0xffff],
  ['del', 0xffff],
  ['insert', 0xff63],
  ['home', 0xff50],
  ['end', 0xff57],
  ['left', 0xff51],
  ['up', 0xff52],
  ['right', 0xff53],
  ['down', 0xff54],
  ['page_up', 0xff55],
  ['pageup', 0xff55],
  ['page_down', 0xff56],
  ['pagedown', 0xff56],
  ['space', 0x20],
  ['plus', 0x2b],
  ['menu', 0xff67]
])

const RETURN_KEYSYM = 0xff0d
const TAB_KEYSYM = 0xff09
const F1_KEYSYM = 0xffbe

/** X11 keysym of one printable character: Latin-1 directly, anything else as Unicode. */
function characterKeysym(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if ((codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff)) {
    return codePoint
  }
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    throw new DesktopError('desktop_invalid_input', 'control characters cannot be typed')
  }
  return 0x01000000 + codePoint
}

function namedKeysym(name: string): number {
  const lower = name.toLowerCase()
  const named = MODIFIER_KEYSYMS.get(lower) ?? NAMED_KEYSYMS.get(lower)
  if (named !== undefined) {
    return named
  }
  const functionKey = /^f([1-9]|1[0-2])$/.exec(lower)
  if (functionKey) {
    return F1_KEYSYM + Number(functionKey[1]) - 1
  }
  if ([...name].length === 1) {
    return characterKeysym(name)
  }
  throw new DesktopError('desktop_invalid_input', `unknown key "${name.slice(0, 32)}"`)
}

/** Keysyms of a combo such as `ctrl+shift+t`, in press order; release them in reverse. */
export function keysymsFor(combo: string): number[] {
  const parts = combo.split('+').map((part) => part.trim())
  if (parts.some((part) => part.length === 0)) {
    throw new DesktopError('desktop_invalid_input', 'empty key in combo (use "plus" for +)')
  }
  return parts.map(namedKeysym)
}

/** One chord per typed character; `\r\n`, `\r` and `\n` type Return. */
export function keysymsForText(text: string): number[][] {
  const chords: number[][] = []
  const characters = [...text.replace(/\r\n?/g, '\n')]
  for (const character of characters) {
    if (character === '\n') {
      chords.push([RETURN_KEYSYM])
    } else if (character === '\t') {
      chords.push([TAB_KEYSYM])
    } else {
      chords.push([characterKeysym(character)])
    }
  }
  return chords
}
