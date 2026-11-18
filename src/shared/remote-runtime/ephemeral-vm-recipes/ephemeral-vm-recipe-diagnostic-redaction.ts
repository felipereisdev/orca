import { stripCredentialsFromMessage } from '../../git/remotes/git-remote-error'

const SECRET_JSON_KEYS =
  'pairingCode|deviceToken|publicKeyB64|token|secret|password|apiKey|accessToken|identityFile|identityAgent|proxyCommand'
// Escape-aware so a value holding `\"` is redacted whole.
const SECRET_JSON_FIELD = new RegExp(
  `("(?:${SECRET_JSON_KEYS})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  'gi'
)
const TRAILING_SECRET_JSON_KEY = new RegExp(`"(?:${SECRET_JSON_KEYS})"\\s*:\\s*$`, 'i')
// Bounds memory when a process never ends a line; past it the buffer is forwarded as is.
const MAX_STREAM_REDACTION_BUFFER_CHARS = 256 * 1024

// Kept apart from the result diagnostics so browser bundles can redact without the pairing codec.
export function redactEphemeralVmRecipeDiagnosticText(text: string): string {
  if (!text) {
    return text
  }
  return stripCredentialsFromMessage(text)
    .replace(/orca:\/\/pair\?code=[A-Za-z0-9_-]+/g, 'orca://pair?code=[redacted]')
    .replace(SECRET_JSON_FIELD, '$1"[redacted]"')
}

export type EphemeralVmRecipeDiagnosticStreamRedactor = {
  push(chunk: string): string
  flush(): string
}

/** Holds output until a line ends, since JSON strings cannot span lines, so chunk splits never expose a secret. */
export function createEphemeralVmRecipeDiagnosticStreamRedactor(): EphemeralVmRecipeDiagnosticStreamRedactor {
  let pending = ''
  return {
    push(chunk) {
      pending += chunk
      const lineEnd = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r')) + 1
      // A key whose value starts on the next line waits for that value.
      const cut =
        pending.length > MAX_STREAM_REDACTION_BUFFER_CHARS
          ? pending.length
          : (TRAILING_SECRET_JSON_KEY.exec(pending.slice(0, lineEnd))?.index ?? lineEnd)
      const ready = pending.slice(0, cut)
      pending = pending.slice(cut)
      return redactEphemeralVmRecipeDiagnosticText(ready)
    },
    flush() {
      const rest = pending
      pending = ''
      return redactEphemeralVmRecipeDiagnosticText(rest)
    }
  }
}
