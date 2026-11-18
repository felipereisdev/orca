import { redactEphemeralVmRecipeDiagnosticText } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostic-redaction'
import { describeEphemeralVmRecipeStdoutForDiagnostics } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostics'

type ProvisionStream = 'stdout' | 'stderr'
type ProvisionEvent = { provisionId: string; stream: ProvisionStream; chunk: string }

// Bounds memory when stderr never ends a line; past it the buffer is flushed redacted.
const MAX_STDERR_LINE_BUFFER_CHARS = 256 * 1024

/** Streams stderr live by whole lines; stdout carries the result, so it is shown once, parsed and redacted. */
export function createProvisionEventForwarder(
  provisionId: string | undefined,
  send: (event: ProvisionEvent) => void
): { send(stream: ProvisionStream, chunk: string): void; finish(stdout: string): void } {
  let pendingStderr = ''
  let finished = false
  const forward = (stream: ProvisionStream, chunk: string): void => {
    if (provisionId && chunk) {
      send({ provisionId, stream, chunk })
    }
  }
  const forwardStderr = (text: string): void =>
    forward('stderr', redactEphemeralVmRecipeDiagnosticText(text))
  return {
    send: (stream, chunk) => {
      if (stream !== 'stderr' || finished) {
        return
      }
      pendingStderr += chunk
      const lineEnd =
        pendingStderr.length > MAX_STDERR_LINE_BUFFER_CHARS
          ? pendingStderr.length
          : Math.max(pendingStderr.lastIndexOf('\n'), pendingStderr.lastIndexOf('\r')) + 1
      forwardStderr(pendingStderr.slice(0, lineEnd))
      pendingStderr = pendingStderr.slice(lineEnd)
    },
    finish: (stdout) => {
      if (finished) {
        return
      }
      finished = true
      forwardStderr(pendingStderr)
      pendingStderr = ''
      forward('stdout', describeEphemeralVmRecipeStdoutForDiagnostics(stdout))
    }
  }
}
