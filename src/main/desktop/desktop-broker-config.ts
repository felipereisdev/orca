import { DesktopError } from './desktop-errors'
import { loopbackLiteral } from './desktop-loopback-host'
import { connectRfbUpstream, desktopFailureReason } from './desktop-upstream'

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

/** True when `next` (its host already normalized) is the configuration `current` holds. */
export function isSameDesktopBrokerConfig(
  current: DesktopBrokerConfig | undefined,
  next: DesktopBrokerConfig
): boolean {
  return (
    current !== undefined &&
    current.host === next.host &&
    current.port === next.port &&
    current.password === next.password &&
    current.launcher?.port === next.launcher?.port &&
    current.launcher?.token === next.launcher?.token
  )
}

/**
 * Authenticates once with `cfg` and disconnects: only a caller holding the VNC password (the host,
 * never the agent) can configure, and a wrong one is refused before anything changes.
 */
export async function verifyDesktopCredentials(cfg: DesktopBrokerConfig): Promise<void> {
  const host = assertValidConfig(cfg)
  try {
    const { socket } = await connectRfbUpstream({ host, port: cfg.port, password: cfg.password })
    socket.destroy()
  } catch (error) {
    throw new DesktopError('desktop_unavailable', desktopFailureReason(error))
  }
}
