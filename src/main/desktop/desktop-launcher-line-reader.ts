const MAX_LINE_CHARS = 1024 * 1024

/**
 * Splits launcher text into lines without rescanning, refusing lines over 1 MiB before they are
 * joined or parsed. Returns the unread rest of a chunk when `isPaused` turns true after a line.
 */
export function launcherLineReader(
  onLine: (line: string) => void,
  onOverflow: () => void,
  isPaused: () => boolean
): (chunk: string) => string {
  let pending: string[] = []
  let pendingChars = 0
  let overflowed = false
  const append = (part: string): boolean => {
    pending.push(part)
    pendingChars += part.length
    if (pendingChars > MAX_LINE_CHARS) {
      overflowed = true
      onOverflow()
    }
    return !overflowed
  }
  return (chunk) => {
    let start = 0
    while (!overflowed) {
      const newline = chunk.indexOf('\n', start)
      if (newline === -1) {
        append(chunk.slice(start))
        return ''
      }
      if (!append(chunk.slice(start, newline))) {
        return ''
      }
      const line = pending.join('')
      pending = []
      pendingChars = 0
      start = newline + 1
      onLine(line)
      if (isPaused()) {
        return chunk.slice(start)
      }
    }
    return ''
  }
}
