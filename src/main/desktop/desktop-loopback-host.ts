import { BlockList, isIPv4, isIPv6 } from 'node:net'

const LOOPBACK = new BlockList()
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACK.addAddress('::1', 'ipv6')

/** Only 127.0.0.0/8, ::1 and localhost: the VNC password and launcher token travel in plaintext. */
export function isLoopbackHost(host: string): boolean {
  if (host.toLowerCase() === 'localhost') {
    return true
  }
  if (isIPv4(host)) {
    return LOOPBACK.check(host, 'ipv4')
  }
  return isIPv6(host) && LOOPBACK.check(host, 'ipv6')
}
