import { createEphemeralVmRecipeDiagnosticStreamRedactor } from '../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostic-redaction'

type ProvisionStream = 'stdout' | 'stderr'
type ProvisionEvent = { provisionId: string; stream: ProvisionStream; chunk: string }

/** Forwards live recipe output redacted per stream, so a secret split across chunks stays hidden. */
export function createProvisionEventForwarder(
  provisionId: string | undefined,
  send: (event: ProvisionEvent) => void
): { send(stream: ProvisionStream, chunk: string): void; flush(): void } {
  const redactors = {
    stdout: createEphemeralVmRecipeDiagnosticStreamRedactor(),
    stderr: createEphemeralVmRecipeDiagnosticStreamRedactor()
  }
  const forward = (stream: ProvisionStream, chunk: string): void => {
    if (provisionId && chunk) {
      send({ provisionId, stream, chunk })
    }
  }
  return {
    send: (stream, chunk) => forward(stream, redactors[stream].push(chunk)),
    flush: () => {
      forward('stdout', redactors.stdout.flush())
      forward('stderr', redactors.stderr.flush())
    }
  }
}
