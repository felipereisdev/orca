import { redactEphemeralVmRecipeDiagnosticText } from './ephemeral-vm-recipe-diagnostic-redaction'

const SECRET_KEYWORDS = [
  'pass',
  'passwd',
  'password',
  'token',
  'secret',
  'credential',
  'api_key',
  'api-key',
  'apikey'
]
export const WITHHELD_SECRET_LINE = '[stderr line withheld: may contain a secret]'
/** Leads a retained stderr tail whose head was dropped; the line after it is withheld. */
export const STDERR_HEAD_OMITTED_LINE = '[earlier stderr omitted]'
const LF = 10
const CR = 13

// Why: these run on the Electron main process over untrusted recipe output, so they use
// only linear string operations; no regex that could backtrack on long whitespace runs.
function containsSecretKeyword(lowerLine: string): boolean {
  return SECRET_KEYWORDS.some((keyword) => lowerLine.includes(keyword))
}

function stripTrailingQuote(text: string): string {
  return text.endsWith('"') || text.endsWith("'") ? text.slice(0, -1).trimEnd() : text
}

/** True when a line ends with a secret key whose value may follow on the next line. */
function endsWithSecretKey(lowerLine: string): boolean {
  const trimmed = stripTrailingQuote(lowerLine.trimEnd())
  if (trimmed.endsWith(':') || trimmed.endsWith('=')) {
    return containsSecretKeyword(trimmed)
  }
  // A bare or quoted key, as in pretty-printed `"password"` followed by `: "value"`.
  const key = stripTrailingQuote(trimmed)
  return SECRET_KEYWORDS.some((keyword) => key.endsWith(keyword))
}

export function findStderrLineEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === LF || code === CR) {
      return index
    }
  }
  return -1
}

/** The line break at `index`: CRLF, or a lone CR or LF. */
export function stderrLineEndAt(text: string, index: number): string {
  return text.charCodeAt(index) === CR && text.charCodeAt(index + 1) === LF ? '\r\n' : text[index]
}

/**
 * The conservative stderr rule, one complete line at a time: a line naming a secret keyword is
 * withheld, and so is the next non-blank line after one ending in such a key.
 */
export function createStderrLineSanitizer(): {
  line(line: string, lineEnd: string): string
  /** The next non-blank line is withheld, as when an unseen line may have been a key. */
  withholdNext(): void
} {
  let withholdNextLine = false
  return {
    line: (line, lineEnd) => {
      if (line === STDERR_HEAD_OMITTED_LINE) {
        withholdNextLine = true
        return line + lineEnd
      }
      const lowerLine = line.toLowerCase()
      const blank = lowerLine.trim() === ''
      const withheld = containsSecretKeyword(lowerLine) || (withholdNextLine && !blank)
      if (!blank) {
        // Why: blank lines between a key and its value must not end the withholding.
        withholdNextLine = endsWithSecretKey(lowerLine)
      }
      return withheld
        ? `${WITHHELD_SECRET_LINE}${lineEnd}`
        : redactEphemeralVmRecipeDiagnosticText(line + lineEnd)
    },
    withholdNext: () => {
      withholdNextLine = true
    }
  }
}

/** Every returned stderr diagnostic goes through this before any tail or cap is taken. */
export function sanitizeEphemeralVmRecipeStderr(text: string): string {
  if (!text) {
    return text
  }
  const sanitizer = createStderrLineSanitizer()
  let out = ''
  let start = 0
  for (;;) {
    const end = findStderrLineEnd(text, start)
    if (end < 0) {
      break
    }
    const lineEnd = stderrLineEndAt(text, end)
    out += sanitizer.line(text.slice(start, end), lineEnd)
    start = end + lineEnd.length
  }
  return start < text.length ? out + sanitizer.line(text.slice(start), '') : out
}
