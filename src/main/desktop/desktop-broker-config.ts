import { DesktopError } from './desktop-errors'
import { loopbackLiteral } from './desktop-loopback-host'

export type DesktopBrokerConfig = {
  host: string
  port: number
  password: string
  launcher?: { port: number; token: string }
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

/** Validates a configuration; returns the literal loopback address every connection must use. */
export function assertValidConfig(cfg: DesktopBrokerConfig): string {
  if (typeof cfg.host !== 'string' || cfg.host.length === 0 || !validPort(cfg.port)) {
    throw new DesktopError('desktop_invalid_input', 'host and port are required')
  }
  const host = loopbackLiteral(cfg.host)
  if (host === undefined) {
    throw new DesktopError('desktop_invalid_input', 'host must be a loopback address')
  }
  if (typeof cfg.password !== 'string' || cfg.password.length === 0) {
    throw new DesktopError('desktop_invalid_input', 'a VNC password is required')
  }
  if (cfg.launcher && (!validPort(cfg.launcher.port) || typeof cfg.launcher.token !== 'string')) {
    throw new DesktopError('desktop_invalid_input', 'launcher needs a port and a token')
  }
  return host
}
