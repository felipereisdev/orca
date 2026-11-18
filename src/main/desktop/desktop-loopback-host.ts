import { isIPv4 } from 'node:net'

/**
 * The literal loopback address to connect to, or undefined when `host` is not one: the VNC
 * password and launcher token travel in plaintext. `localhost` becomes 127.0.0.1; otherwise only
 * literal IPv4 127.x.x.x and `::1` pass (no IPv4-mapped forms, no names), so nothing resolves DNS.
 */
export function loopbackLiteral(host: string): string | undefined {
  if (host.toLowerCase() === 'localhost') {
    return '127.0.0.1'
  }
  if (host === '::1' || (isIPv4(host) && host.startsWith('127.'))) {
    return host
  }
  return undefined
}
