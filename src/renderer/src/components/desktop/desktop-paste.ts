import { keysymForCodePoint } from '../../../../shared/desktop-keysyms'

const XK_CONTROL_L = 0xffe3
const XK_V = 0x0076
const MODIFIER_KEYSYMS = [
  XK_CONTROL_L,
  0xffe4,
  0xffe1,
  0xffe2,
  0xffe9,
  0xffea,
  0xffe7,
  0xffe8,
  0xffeb,
  0xffec
]

/** The parts of noVNC's RFB client a paste uses; both send nothing while it is view-only. */
export type DesktopPasteTarget = {
  clipboardPasteFrom: (text: string) => void
  sendKey: (keysym: number, code: string, down: boolean) => void
}

/**
 * Plain ClientCutText only carries Latin-1. Type Unicode text as keys instead.
 * The broker passes input only while this viewer holds control.
 */
export function pasteIntoDesktop(rfb: DesktopPasteTarget, text: string): void {
  if (!text) {
    return
  }
  // noVNC may have already forwarded the paste shortcut's modifier keydown.
  for (const keysym of MODIFIER_KEYSYMS) {
    rfb.sendKey(keysym, '', false)
  }
  if (/[\u0100-\u{10ffff}]/u.test(text)) {
    for (const character of text.replace(/\r\n?/g, '\n')) {
      const codePoint = character.codePointAt(0) ?? 0
      const keysym =
        character === '\n' ? 0xff0d : character === '\t' ? 0xff09 : keysymForCodePoint(codePoint)
      rfb.sendKey(keysym, '', true)
      rfb.sendKey(keysym, '', false)
    }
    return
  }
  rfb.clipboardPasteFrom(text)
  rfb.sendKey(XK_CONTROL_L, 'ControlLeft', true)
  rfb.sendKey(XK_V, 'KeyV', true)
  rfb.sendKey(XK_V, 'KeyV', false)
  rfb.sendKey(XK_CONTROL_L, 'ControlLeft', false)
}

/** Cmd+V on a Mac, Ctrl+V elsewhere: the Mac's own paste shortcut, not the guest's. */
export function isDesktopPasteShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac: boolean
): boolean {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v'
}
