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
const XVP = Buffer.from([250, 0, 1, 2])
// Button 8 sets the PointerEvent mask's top bit; still a plain 6-byte message.
const BUTTON_8_POINTER = Buffer.from([5, 0x80, 0, 10, 0, 20])
const INPUT = [SET_DESKTOP_SIZE, XVP, BUTTON_8_POINTER]

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

const EXTENSION_TYPES = new Set([248, 150, 251, 250, 5])

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

  it('removes ExtendedMouseButtons and QEMU Extended Key Event from a SetEncodings', async () => {
    const { server, openViewer } = await fixture()
    const viewer = await openViewer('v1')

    viewer.setEncodings([0, -258, -312, -316, -223])
    viewer.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))

    const fromViewer = server.received.filter(
      (message) => message[0] === 2 && message.readInt32BE(4 + 4 * 1) === -312
    )
    expect(fromViewer).toEqual([
      Buffer.from([2, 0, 0, 3, 0, 0, 0, 0, 0xff, 0xff, 0xfe, 0xc8, 0xff, 0xff, 0xff, 0x21])
    ])
  })
})
