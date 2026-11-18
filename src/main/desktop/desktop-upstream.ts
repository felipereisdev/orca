import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { performRfbClientHandshake, type RfbServerInit } from './rfb/rfb-client-handshake'
import { RfbError } from './rfb/rfb-protocol'

export type DesktopVncTarget = { host: string; port: number; password: string }

export const DESKTOP_HANDSHAKE_TIMEOUT_MS = 10_000

/** Status reasons are fixed codes, so nothing a peer or the OS says (or the password) leaks. */
export function desktopFailureReason(error: unknown): string {
  if (error instanceof RfbError) {
    return error.code
  }
  if (error instanceof DesktopTimeoutError) {
    return 'desktop_vnc_timeout'
  }
  return 'desktop_vnc_unreachable'
}

class DesktopTimeoutError extends Error {
  constructor() {
    super('desktop_vnc_timeout')
  }
}

/** Runs `work` on `socket`; destroys the socket and rejects if it takes longer than the limit. */
export async function withSocketTimeout<T>(
  socket: Duplex,
  work: () => Promise<T>,
  timeoutMs = DESKTOP_HANDSHAKE_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DesktopTimeoutError())
      socket.destroy()
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(), expired])
  } finally {
    clearTimeout(timer)
  }
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      socket.off('error', reject)
      resolve()
    })
    socket.once('error', reject)
  })
}

/**
 * Opens one authenticated RFB connection to the VNC server. `afterHandshake` runs inside the same
 * timeout (the control connection waits for its first frame there).
 */
export async function connectRfbUpstream(
  target: DesktopVncTarget,
  afterHandshake?: (socket: Socket, init: RfbServerInit) => Promise<void>
): Promise<{ socket: Socket; init: RfbServerInit }> {
  const socket = connect({ host: target.host, port: target.port })
  socket.setNoDelay(true)
  // Late errors surface to callers as 'close'; without a listener they would crash main.
  socket.on('error', () => {})
  try {
    return await withSocketTimeout(socket, async () => {
      await waitForConnect(socket)
      const init = await performRfbClientHandshake(socket, {
        password: target.password,
        shared: true
      })
      await afterHandshake?.(socket, init)
      return { socket, init }
    })
  } catch (error) {
    socket.destroy()
    throw error
  }
}
