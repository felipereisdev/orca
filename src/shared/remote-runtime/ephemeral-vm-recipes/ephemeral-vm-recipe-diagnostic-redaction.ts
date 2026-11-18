import { stripCredentialsFromMessage } from '../../git/remotes/git-remote-error'

const SECRET_JSON_KEYS =
  'pairingCode|deviceToken|publicKeyB64|token|secret|password|apiKey|accessToken|identityFile|identityAgent|proxyCommand'
// Escape-aware so a value holding `\"` is redacted whole.
const SECRET_JSON_FIELD = new RegExp(
  `("(?:${SECRET_JSON_KEYS})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  'gi'
)

// Kept apart from the result diagnostics so browser bundles can redact without the pairing codec.
export function redactEphemeralVmRecipeDiagnosticText(text: string): string {
  if (!text) {
    return text
  }
  return stripCredentialsFromMessage(text)
    .replace(/orca:\/\/pair\?code=[A-Za-z0-9_-]+/g, 'orca://pair?code=[redacted]')
    .replace(SECRET_JSON_FIELD, '$1"[redacted]"')
}
