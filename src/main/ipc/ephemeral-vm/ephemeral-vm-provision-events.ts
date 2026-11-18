import { redactEphemeralVmRecipeDiagnosticText } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostic-redaction'
import { describeEphemeralVmRecipeStdoutForDiagnostics } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostics'

type ProvisionStream = 'stdout' | 'stderr'
type ProvisionEvent = { provisionId: string; stream: ProvisionStream; chunk: string }

// Bounds memory when stderr never ends a line; past it the line is withheld and discarded.
const MAX_STDERR_LINE_BUFFER_BYTES = 256 * 1024
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
const WITHHELD_SECRET_LINE = '[stderr line withheld: may contain a secret]'
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

function findLineEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === LF || code === CR) {
      return index
    }
  }
  return -1
}

/**
 * Streams stderr live by complete lines and withholds any line that may carry a secret.
 * Stdout carries the result, so it is shown once, parsed and redacted.
 */
export function createProvisionEventForwarder(
  provisionId: string | undefined,
  send: (event: ProvisionEvent) => void
): { send(stream: ProvisionStream, chunk: string): void; finish(stdout: string): void } {
  let pendingStderr = ''
  let pendingStderrBytes = 0
  // Set while an over-cap line is being discarded until its line break.
  let discarding = false
  let withholdNextLine = false
  let finished = false
  const forward = (stream: ProvisionStream, chunk: string): void => {
    if (provisionId && chunk) {
      send({ provisionId, stream, chunk })
    }
  }
  const forwardStderrLine = (line: string, lineEnd: string): void => {
    const lowerLine = line.toLowerCase()
    const blank = lowerLine.trim() === ''
    const withheld = containsSecretKeyword(lowerLine) || (withholdNextLine && !blank)
    if (!blank) {
      // Why: blank lines between a key and its value must not end the withholding.
      withholdNextLine = endsWithSecretKey(lowerLine)
    }
    forward(
      'stderr',
      withheld
        ? `${WITHHELD_SECRET_LINE}${lineEnd}`
        : redactEphemeralVmRecipeDiagnosticText(line + lineEnd)
    )
  }
  const lineEndAt = (text: string, index: number): string =>
    text.charCodeAt(index) === CR && text.charCodeAt(index + 1) === LF ? '\r\n' : text[index]
  const processStderr = (chunk: string): void => {
    let start = 0
    if (discarding) {
      const end = findLineEnd(chunk, 0)
      if (end < 0) {
        return
      }
      discarding = false
      // Why: the discarded line's tail is unknown, so it may have been a key awaiting its value.
      withholdNextLine = true
      start = end + lineEndAt(chunk, end).length
    }
    for (;;) {
      const end = findLineEnd(chunk, start)
      if (end < 0) {
        break
      }
      // Why: a \r is a line end on its own; a \n that follows in a later chunk is a blank line.
      const lineEnd = lineEndAt(chunk, end)
      forwardStderrLine(pendingStderr + chunk.slice(start, end), lineEnd)
      pendingStderr = ''
      pendingStderrBytes = 0
      start = end + lineEnd.length
    }
    const rest = chunk.slice(start)
    pendingStderr += rest
    pendingStderrBytes += Buffer.byteLength(rest)
    if (pendingStderrBytes > MAX_STDERR_LINE_BUFFER_BYTES) {
      forward(
        'stderr',
        `[stderr line withheld: ${pendingStderrBytes} bytes without a line break]\n`
      )
      discarding = true
      pendingStderr = ''
      pendingStderrBytes = 0
    }
  }
  return {
    send: (stream, chunk) => {
      if (stream !== 'stderr' || finished) {
        return
      }
      processStderr(chunk)
    },
    finish: (stdout) => {
      if (finished) {
        return
      }
      finished = true
      if (pendingStderr) {
        forwardStderrLine(pendingStderr, '')
      }
      pendingStderr = ''
      forward('stdout', describeEphemeralVmRecipeStdoutForDiagnostics(stdout))
    }
  }
}
