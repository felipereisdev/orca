import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Mutual proof of the launcher token without sending it. Nonces are 32 random bytes in hex; each
 * proof is hex HMAC-SHA256(token, "<label>|<first nonce>|<second nonce>"):
 *   launcher proves "orca-launcher-server|<broker nonce>|<launcher nonce>",
 *   broker proves   "orca-launcher-client|<launcher nonce>|<broker nonce>".
 */
const NONCE_PATTERN = /^[0-9a-f]{64}$/

export function newLauncherNonce(): string {
  return randomBytes(32).toString('hex')
}

export function isLauncherNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_PATTERN.test(value)
}

export function launcherServerProof(
  token: string,
  brokerNonce: string,
  launcherNonce: string
): string {
  return createHmac('sha256', token)
    .update(`orca-launcher-server|${brokerNonce}|${launcherNonce}`)
    .digest('hex')
}

export function launcherClientProof(
  token: string,
  launcherNonce: string,
  brokerNonce: string
): string {
  return createHmac('sha256', token)
    .update(`orca-launcher-client|${launcherNonce}|${brokerNonce}`)
    .digest('hex')
}

export function proofMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string' || received.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}
