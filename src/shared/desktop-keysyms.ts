/** X11 represents Latin-1 directly and prefixes other Unicode code points. */
export function keysymForCodePoint(codePoint: number): number {
  return codePoint <= 0xff ? codePoint : 0x01000000 + codePoint
}
