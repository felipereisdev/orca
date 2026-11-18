import { DesktopBroker } from '../desktop-broker'
import { startFakeRfbServer, type FakeRfbServer } from './fake-rfb-server'
import { connectFakeRfbViewer, type FakeRfbViewer } from './fake-rfb-viewer'

export const FIXTURE_PASSWORD = 'pw-7f3a9c'

export type DesktopBrokerFixture = {
  server: FakeRfbServer
  broker: DesktopBroker
  openViewer(viewerId: string): Promise<FakeRfbViewer>
  close(): Promise<void>
}

/** A fake VNC server and a broker configured against it, ready to use. */
export async function startDesktopBrokerFixture(
  size: { width: number; height: number } = { width: 64, height: 48 }
): Promise<DesktopBrokerFixture> {
  const server = await startFakeRfbServer({ password: FIXTURE_PASSWORD, ...size })
  const broker = new DesktopBroker()
  await broker.configure({ host: '127.0.0.1', port: server.port, password: FIXTURE_PASSWORD })
  return {
    server,
    broker,
    openViewer: (viewerId) =>
      connectFakeRfbViewer((downstream) => broker.openViewer(viewerId, downstream)),
    close: async () => {
      broker.close()
      await server.close()
    }
  }
}

/** [buttonMask, x, y] of every PointerEvent the server received. */
export function pointerEvents(received: Buffer[]): [number, number, number][] {
  return received
    .filter((message) => message[0] === 5)
    .map((message) => [message[1], message.readUInt16BE(2), message.readUInt16BE(4)])
}

/** [down, keysym] of every KeyEvent the server received. */
export function keyEvents(received: Buffer[]): [boolean, number][] {
  return received
    .filter((message) => message[0] === 4)
    .map((message) => [message[1] === 1, message.readUInt32BE(4)])
}

/** True once the server has a FramebufferUpdateRequest for exactly this region size. */
export function hasUpdateRequest(width: number, height: number) {
  return (received: Buffer[]): boolean =>
    received.some(
      (message) =>
        message[0] === 3 && message.readUInt16BE(6) === width && message.readUInt16BE(8) === height
    )
}
