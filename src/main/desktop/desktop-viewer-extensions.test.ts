import { afterEach, describe, expect, it } from 'vitest'
import {
  hasUpdateRequest,
  startDesktopBrokerFixture,
  type DesktopBrokerFixture
} from './testing/desktop-broker-fixture'

// The exact bytes noVNC 1.7's RFB.messages encoders write (core/rfb.js).
const CLIENT_FENCE = Buffer.from([248, 0, 0, 0, 0, 0, 0, 3, 2, 0x61, 0x62])
const ENABLE_CONTINUOUS_UPDATES = Buffer.from([150, 1, 0, 0, 0, 0, 0, 64, 0, 48])
const SET_DESKTOP_SIZE = Buffer.from([
  251, 0, 0, 80, 0, 60, 1, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 80, 0, 60, 0, 0, 0, 0
])
const QEMU_KEY = Buffer.from([255, 0, 0, 1, 0, 0, 0, 0x61, 0, 0, 0, 0x1e])
const XVP = Buffer.from([250, 0, 1, 2])
const EXTENDED_POINTER = Buffer.from([5, 0x80, 0, 10, 0, 20, 1])
const INPUT = [SET_DESKTOP_SIZE, QEMU_KEY, XVP, EXTENDED_POINTER]

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function fixture(): Promise<DesktopBrokerFixture> {
  const started = await startDesktopBrokerFixture({ width: 64, height: 48 })
  cleanups.push(() => started.close())
  return started
}

const EXTENSION_TYPES = new Set([248, 150, 251, 255, 250, 5])

/** The extension messages (and pointer events) the server got, in arrival order. */
function forwarded(received: Buffer[]): Buffer[] {
  return received.filter((message) => EXTENSION_TYPES.has(message[0]))
}

describe('noVNC extension messages through the broker', () => {
  it('forwards fence and continuous updates from a viewer without control', async () => {
    const { server, openViewer } = await fixture()
    const viewer = await openViewer('v1')

    viewer.socket.write(Buffer.concat([CLIENT_FENCE, ENABLE_CONTINUOUS_UPDATES]))
    viewer.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))

    expect(forwarded(server.received)).toEqual([CLIENT_FENCE, ENABLE_CONTINUOUS_UPDATES])
    expect(viewer.socket.destroyed).toBe(false)
  })

  it('drops extension input from a viewer without control and keeps it open', async () => {
    const { server, openViewer } = await fixture()
    const viewer = await openViewer('v1')

    viewer.socket.write(Buffer.concat(INPUT))
    viewer.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))

    expect(forwarded(server.received)).toEqual([])
    expect(viewer.socket.destroyed).toBe(false)
  })

  it('forwards extension input from the controlling viewer', async () => {
    const { broker, server, openViewer } = await fixture()
    const viewer = await openViewer('v1')
    broker.setOwner('user', 'v1')

    viewer.socket.write(Buffer.concat(INPUT))
    viewer.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))

    expect(forwarded(server.received)).toEqual(INPUT)
  })
})
