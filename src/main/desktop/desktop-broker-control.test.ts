import { duplexPair } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasUpdateRequest,
  keyEvents,
  pointerEvents,
  startDesktopBrokerFixture,
  type DesktopBrokerFixture
} from './testing/desktop-broker-fixture'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function fixture(): Promise<DesktopBrokerFixture> {
  const started = await startDesktopBrokerFixture({ width: 64, height: 48 })
  cleanups.push(() => started.close())
  return started
}

describe('DesktopBroker control ownership', () => {
  it('viewer input is dropped while the agent owns the desktop', async () => {
    const { server, openViewer } = await fixture()
    const viewer = await openViewer('v1')

    viewer.pointer(10, 11, 1)
    viewer.key(true, 0x61)
    viewer.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))

    expect(pointerEvents(server.received)).toEqual([])
    expect(keyEvents(server.received)).toEqual([])
  })

  it("viewer input passes after setOwner('user', viewerId)", async () => {
    const { broker, server, openViewer } = await fixture()
    const viewer = await openViewer('v1')

    broker.setOwner('user', 'v1')
    viewer.pointer(10, 11, 1)
    viewer.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))

    expect(broker.status().owner).toBe('user')
    expect(pointerEvents(server.received)).toEqual([[1, 10, 11]])
  })

  it('pasted clipboard text reaches the desktop only from the viewer holding control', async () => {
    const { broker, server, openViewer } = await fixture()
    const viewer = await openViewer('v1')
    const cutText = (text: string): Buffer => {
      const message = Buffer.alloc(8 + text.length)
      message[0] = 6
      message.writeUInt32BE(text.length, 4)
      message.write(text, 8, 'latin1')
      return message
    }

    viewer.socket.write(cutText('before'))
    viewer.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))
    broker.setOwner('user', 'v1')
    viewer.socket.write(cutText('after'))
    await server.waitForReceived((received) => received.some((m) => m[0] === 6))

    expect(
      server.received.filter((m) => m[0] === 6).map((m) => m.subarray(8).toString('latin1'))
    ).toEqual(['after'])
  })

  it("another viewer's input is still dropped while one viewer holds control", async () => {
    const { broker, server, openViewer } = await fixture()
    await openViewer('v1')
    const other = await openViewer('v2')

    broker.setOwner('user', 'v1')
    other.pointer(3, 4, 1)
    other.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))

    expect(pointerEvents(server.received)).toEqual([])
  })

  it('agent click is refused with desktop_user_in_control while the user owns it and sent as PointerEvent down/up when the agent owns it', async () => {
    const { broker, server, openViewer } = await fixture()
    await openViewer('v1')

    broker.setOwner('user', 'v1')
    await expect(broker.click(5, 6, { button: 'left' })).rejects.toMatchObject({
      code: 'desktop_user_in_control',
      message: 'The user has taken control of the desktop.'
    })

    broker.setOwner('agent')
    await broker.click(5, 6, { button: 'right' })
    await server.waitForReceived((received) => pointerEvents(received).length === 3)
    expect(pointerEvents(server.received)).toEqual([
      [0, 5, 6],
      [4, 5, 6],
      [0, 5, 6]
    ])
  })

  it('control falls back to agent 5 s after the controlling viewer closes', async () => {
    const { broker, openViewer } = await fixture()
    await openViewer('v1')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    broker.setOwner('user', 'v1')

    broker.closeViewer('v1')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(broker.status().owner).toBe('user')
    await vi.advanceTimersByTimeAsync(1)

    expect(broker.status().owner).toBe('agent')
  })

  it('the same viewer reconnecting within 5 s keeps control', async () => {
    const { broker, server, openViewer } = await fixture()
    const first = await openViewer('v1')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    broker.setOwner('user', 'v1')

    first.socket.end()
    await vi.advanceTimersByTimeAsync(3_000)
    const again = await openViewer('v1')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(broker.status().owner).toBe('user')
    again.pointer(8, 9, 1)
    again.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))
    expect(pointerEvents(server.received)).toEqual([[1, 8, 9]])
  })

  it('a long type aborts partway when the user takes control', async () => {
    const { broker, server, openViewer } = await fixture()
    await openViewer('v1')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const typing = broker.type('abcdefghijklmnopqrstuvwxyz')
    const outcome = expect(typing).rejects.toMatchObject({ code: 'desktop_user_in_control' })
    await server.waitForReceived((received) => keyEvents(received).length === 2)
    broker.setOwner('user', 'v1')
    await vi.advanceTimersByTimeAsync(1_000)
    await outcome

    broker.setOwner('agent')
    await broker.move(1, 2)
    await server.waitForReceived((received) => pointerEvents(received).length === 1)
    expect(keyEvents(server.received)).toEqual([
      [true, 0x61],
      [false, 0x61]
    ])
  })

  it('handover releases held keys and mouse buttons', async () => {
    const { broker, server, openViewer } = await fixture()
    const viewer = await openViewer('v1')
    broker.setOwner('user', 'v1')
    viewer.key(true, 0x61)
    viewer.pointer(5, 6, 1)
    await server.waitForReceived((received) => pointerEvents(received).length === 1)

    broker.setOwner('agent')
    await server.waitForReceived((received) => pointerEvents(received).length === 2)

    expect(keyEvents(server.received)).toEqual([
      [true, 0x61],
      [false, 0x61]
    ])
    expect(pointerEvents(server.received)).toEqual([
      [1, 5, 6],
      [0, 5, 6]
    ])
  })

  it("handing control back after a shrink releases the viewer's button inside the new bounds", async () => {
    const { broker, server, openViewer } = await fixture()
    const viewer = await openViewer('v1')
    broker.setOwner('user', 'v1')
    viewer.pointer(40, 30, 1)
    await server.waitForReceived((received) => pointerEvents(received).length === 1)
    server.setSize(16, 12)
    await server.waitForReceived((received) =>
      received.some((m) => m[0] === 3 && m[1] === 0 && m.readUInt16BE(6) === 16)
    )

    broker.setOwner('agent')
    await server.waitForReceived((received) => pointerEvents(received).length === 2)

    expect(pointerEvents(server.received)).toEqual([
      [1, 40, 30],
      [0, 15, 11]
    ])
  })

  it("a viewer's release after the control connection is lost stays inside its own ServerInit bounds", async () => {
    const { broker, server, openViewer } = await fixture()
    const viewer = await openViewer('v1')
    broker.setOwner('user', 'v1')
    viewer.pointer(100, 90, 1)
    await server.waitForReceived((received) => pointerEvents(received).length === 1)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    server.dropConnection(0)
    await vi.waitFor(() => expect(broker.status().state).toBe('unavailable'))

    broker.setOwner('agent')
    await server.waitForReceived((received) => pointerEvents(received).length === 2)

    expect(pointerEvents(server.received)).toEqual([
      [1, 100, 90],
      [0, 63, 47]
    ])
  })

  it("a shrink announced before the control connection is lost bounds the viewer's release", async () => {
    const { broker, server, openViewer } = await fixture()
    const viewer = await openViewer('v1')
    broker.setOwner('user', 'v1')
    viewer.pointer(40, 30, 1)
    await server.waitForReceived((received) => pointerEvents(received).length === 1)
    server.setSize(16, 12)
    await server.waitForReceived((received) =>
      received.some((m) => m[0] === 3 && m[1] === 0 && m.readUInt16BE(6) === 16)
    )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    server.dropConnection(0)
    await vi.waitFor(() => expect(broker.status().state).toBe('unavailable'))

    broker.setOwner('agent')
    await server.waitForReceived((received) => pointerEvents(received).length === 2)

    expect(pointerEvents(server.received)).toEqual([
      [1, 40, 30],
      [0, 15, 11]
    ])
  })

  it("handover mid-drag releases the agent's mouse button", async () => {
    const { broker, server, openViewer } = await fixture()
    await openViewer('v1')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const dragging = broker.drag({ x: 1, y: 1 }, { x: 20, y: 20 })
    const outcome = expect(dragging).rejects.toMatchObject({ code: 'desktop_user_in_control' })
    await server.waitForReceived((received) => pointerEvents(received).length === 2)
    broker.setOwner('user', 'v1')
    await vi.advanceTimersByTimeAsync(1_000)
    await outcome
    await server.waitForReceived((received) => pointerEvents(received).length === 3)

    expect(pointerEvents(server.received)).toEqual([
      [0, 1, 1],
      [1, 1, 1],
      [0, 1, 1]
    ])
  })

  it('a pending reconnect does not extend the fallback deadline', async () => {
    const { broker, openViewer } = await fixture()
    await openViewer('v1')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    broker.setOwner('user', 'v1')
    broker.closeViewer('v1')
    await vi.advanceTimersByTimeAsync(3_000)

    const [silent] = duplexPair()
    const pending = broker.openViewer('v1', silent).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(broker.status().owner).toBe('agent')
    broker.closeViewer('v1')
    expect(await pending).toMatchObject({ code: 'desktop_unavailable' })
  })

  it('closeViewer cancels a viewer that is still connecting', async () => {
    const { broker } = await fixture()
    // Frozen clock: only cancellation, not the 10 s handshake timeout, can settle the open.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const [silent] = duplexPair()

    const pending = broker.openViewer('v1', silent)
    broker.closeViewer('v1')

    await expect(pending).rejects.toMatchObject({ code: 'desktop_unavailable' })
    expect(silent.destroyed).toBe(true)
  })

  it('a newer open for the same viewer supersedes one still connecting', async () => {
    const { broker, server, openViewer } = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const [silent] = duplexPair()

    const first = broker.openViewer('v1', silent).catch((error: unknown) => error)
    const second = await openViewer('v1')
    expect(await first).toMatchObject({ code: 'desktop_unavailable' })

    broker.setOwner('user', 'v1')
    second.pointer(2, 3, 1)
    second.requestUpdate(false, 7, 5)
    await server.waitForReceived(hasUpdateRequest(7, 5))
    expect(pointerEvents(server.received)).toEqual([[1, 2, 3]])
  })
})
