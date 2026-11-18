import { redactEphemeralVmRecipeDiagnosticText } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostic-redaction'
import { describeEphemeralVmRecipeStdoutForDiagnostics } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostics'

type ProvisionStream = 'stdout' | 'stderr'
type ProvisionEvent = { provisionId: string; stream: ProvisionStream; chunk: string }

// Bounds memory when stderr never ends a line; past it the line is withheld and discarded.
const MAX_STDERR_LINE_BUFFER_CHARS = 256 * 1024
const SECRET_KEY_PATTERN = /pass(word|wd)?|token|secret|credential|api[_-]?key/i
// A line that ends with a secret key (pretty-printed JSON, YAML, `key =`) may carry
// its value on the next line, so that line is withheld too.
const SECRET_KEY_AT_LINE_END_PATTERN =
  /(?:pass(?:word|wd)?|token|secret|credential|api[_-]?key)["']?\s*(?:[:=]\s*["']?\s*)?$/i
const LINE_END_PATTERN = /\r\n|\r|\n/
const WITHHELD_SECRET_LINE = '[stderr line withheld: may contain a secret]'
const DISCARDED_TAIL_CHARS = 256

/**
 * Streams stderr live by complete lines and withholds any line that may carry a secret.
 * Stdout carries the result, so it is shown once, parsed and redacted.
 */
export function createProvisionEventForwarder(
  provisionId: string | undefined,
  send: (event: ProvisionEvent) => void
): { send(stream: ProvisionStream, chunk: string): void; finish(stdout: string): void } {
  let pendingStderr = ''
  // Set while an over-cap line is being discarded until its line break.
  let discarding = false
  let discardedTail = ''
  let withholdNextLine = false
  let finished = false
  const forward = (stream: ProvisionStream, chunk: string): void => {
    if (provisionId && chunk) {
      send({ provisionId, stream, chunk })
    }
  }
  const forwardStderrLine = (line: string, lineEnd: string): void => {
    const blank = line.trim() === ''
    const withheld = SECRET_KEY_PATTERN.test(line) || (withholdNextLine && !blank)
    if (!blank) {
      // Why: blank lines (or a split \r\n) between a key and its value must not end the withholding.
      withholdNextLine = SECRET_KEY_AT_LINE_END_PATTERN.test(line)
    }
    forward(
      'stderr',
      withheld
        ? `${WITHHELD_SECRET_LINE}${lineEnd}`
        : redactEphemeralVmRecipeDiagnosticText(line + lineEnd)
    )
  }
  const processStderr = (chunk: string): void => {
    let rest = chunk
    if (discarding) {
      const match = LINE_END_PATTERN.exec(rest)
      if (!match) {
        discardedTail = (discardedTail + rest).slice(-DISCARDED_TAIL_CHARS)
        return
      }
      const tail = (discardedTail + rest.slice(0, match.index)).slice(-DISCARDED_TAIL_CHARS)
      withholdNextLine = SECRET_KEY_AT_LINE_END_PATTERN.test(tail)
      discarding = false
      discardedTail = ''
      rest = rest.slice(match.index + match[0].length)
    }
    pendingStderr += rest
    for (;;) {
      const match = LINE_END_PATTERN.exec(pendingStderr)
      // Why: a trailing \r may be the first half of \r\n; wait for the next chunk to tell.
      if (!match || (match[0] === '\r' && match.index === pendingStderr.length - 1)) {
        break
      }
      forwardStderrLine(pendingStderr.slice(0, match.index), match[0])
      pendingStderr = pendingStderr.slice(match.index + match[0].length)
    }
    if (pendingStderr.length > MAX_STDERR_LINE_BUFFER_CHARS) {
      const bytes = Buffer.byteLength(pendingStderr)
      forward('stderr', `[stderr line withheld: ${bytes} bytes without a line break]\n`)
      discarding = true
      discardedTail = pendingStderr.slice(-DISCARDED_TAIL_CHARS)
      pendingStderr = ''
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
      if (pendingStderr.endsWith('\r')) {
        forwardStderrLine(pendingStderr.slice(0, -1), '\r')
      } else if (pendingStderr) {
        forwardStderrLine(pendingStderr, '')
      }
      pendingStderr = ''
      forward('stdout', describeEphemeralVmRecipeStdoutForDiagnostics(stdout))
    }
  }
}
