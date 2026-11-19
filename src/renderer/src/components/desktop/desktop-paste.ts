const XK_CONTROL_L = 0xffe3
const XK_V = 0x0076

/** The parts of noVNC's RFB client a paste uses; both send nothing while it is view-only. */
export type DesktopPasteTarget = {
  clipboardPasteFrom: (text: string) => void
  sendKey: (keysym: number, code: string, down: boolean) => void
}

/**
 * Puts the Mac's text on the guest clipboard (ClientCutText), then presses ctrl+v there. The
 * broker passes both only while this viewer holds control.
 */
export function pasteIntoDesktop(rfb: DesktopPasteTarget, text: string): void {
  if (!text) {
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
