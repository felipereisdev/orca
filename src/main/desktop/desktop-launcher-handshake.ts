import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Mutual proof of the launcher token without sending it. Nonces are 32 random bytes in hex; each
 * proof is hex HMAC-SHA256(token, "<label>|<first nonce>|<second nonce>"):
 *   launcher proves "orca-launcher-server|<broker nonce>|<launcher nonce>",
 *   broker proves   "orca-launcher-client|<launcher nonce>|<broker nonce>".
 */
const HEX_32_BYTES = /^[0-9a-f]{64}$/

function isHex32(value: unknown): value is string {
  return typeof value === 'string' && HEX_32_BYTES.test(value)
}

export function newLauncherNonce(): string {
  return randomBytes(32).toString('hex')
}

export function isLauncherNonce(value: unknown): value is string {
  return isHex32(value)
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

/** Accepts only a well-formed proof (64 lowercase hex characters); never throws. */
export function proofMatches(expected: string, received: unknown): boolean {
  if (!isHex32(expected) || !isHex32(received)) {
    return false
  }
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
}
