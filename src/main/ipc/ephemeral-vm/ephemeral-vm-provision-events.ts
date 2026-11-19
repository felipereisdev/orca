import { describeEphemeralVmRecipeStdoutForDiagnostics } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostics'
import {
  createStderrLineSanitizer,
  findStderrLineEnd,
  stderrLineEndAt
} from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-stderr-sanitizer'

type ProvisionStream = 'stdout' | 'stderr'
type ProvisionEvent = { provisionId: string; stream: ProvisionStream; chunk: string }

// Bounds memory when stderr never ends a line; past it the line is withheld and discarded.
const MAX_STDERR_LINE_BUFFER_BYTES = 256 * 1024

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
  const sanitizer = createStderrLineSanitizer()
  let finished = false
  let senderLost = false
  const forward = (stream: ProvisionStream, chunk: string): void => {
    if (!provisionId || !chunk || senderLost) {
      return
    }
    try {
      send({ provisionId, stream, chunk })
    } catch {
      // A closed window only loses the live log; cleanup and cancellation must still run.
      senderLost = true
    }
  }
  const forwardStderrLine = (line: string, lineEnd: string): void =>
    forward('stderr', sanitizer.line(line, lineEnd))
  const processStderr = (chunk: string): void => {
    let start = 0
    if (discarding) {
      const end = findStderrLineEnd(chunk, 0)
      if (end < 0) {
        return
      }
      discarding = false
      // Why: the discarded line's tail is unknown, so it may have been a key awaiting its value.
      sanitizer.withholdNext()
      start = end + stderrLineEndAt(chunk, end).length
    }
    for (;;) {
      const end = findStderrLineEnd(chunk, start)
      if (end < 0) {
        break
      }
      // Why: a \r is a line end on its own; a \n that follows in a later chunk is a blank line.
      const lineEnd = stderrLineEndAt(chunk, end)
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
