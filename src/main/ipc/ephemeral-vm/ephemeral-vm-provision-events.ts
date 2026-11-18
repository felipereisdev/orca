import { redactEphemeralVmRecipeDiagnosticText } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostic-redaction'
import { describeEphemeralVmRecipeStdoutForDiagnostics } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostics'

type ProvisionStream = 'stdout' | 'stderr'
type ProvisionEvent = { provisionId: string; stream: ProvisionStream; chunk: string }

/** Streams stderr live; stdout carries the result and its secrets, so it is shown once, parsed and redacted. */
export function createProvisionEventForwarder(
  provisionId: string | undefined,
  send: (event: ProvisionEvent) => void
): { send(stream: ProvisionStream, chunk: string): void; finishStdout(stdout: string): void } {
  let stdoutShown = false
  const forward = (stream: ProvisionStream, chunk: string): void => {
    if (provisionId && chunk) {
      send({ provisionId, stream, chunk })
    }
  }
  return {
    send: (stream, chunk) => {
      if (stream === 'stderr') {
        forward(stream, redactEphemeralVmRecipeDiagnosticText(chunk))
      }
    },
    finishStdout: (stdout) => {
      if (!stdoutShown) {
        stdoutShown = true
        forward('stdout', describeEphemeralVmRecipeStdoutForDiagnostics(stdout))
      }
    }
  }
}
