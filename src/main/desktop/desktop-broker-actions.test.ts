import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopBroker } from './desktop-broker'
import {
  FIXTURE_PASSWORD,
  pointerEvents,
  startDesktopBrokerFixture,
  type DesktopBrokerFixture
} from './testing/desktop-broker-fixture'
import { startFakeRfbServer } from './testing/fake-rfb-server'

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

describe('DesktopBroker agent commands', () => {
  it('a paced drag does not resume on a reconfigured desktop', async () => {
    const { broker, server } = await fixture()
    const replacement = await startFakeRfbServer({
      password: FIXTURE_PASSWORD,
      width: 64,
      height: 48
    })
    cleanups.push(() => replacement.close())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const dragging = broker.drag({ x: 1, y: 1 }, { x: 20, y: 20 })
    const outcome = expect(dragging).rejects.toMatchObject({ code: 'desktop_unavailable' })
    await server.waitForReceived((received) => pointerEvents(received).length === 2)
    await broker.configure({
      host: '127.0.0.1',
      port: replacement.port,
      password: FIXTURE_PASSWORD
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await outcome

    await broker.move(30, 31)
    await replacement.waitForReceived((received) => pointerEvents(received).length === 1)
    expect(pointerEvents(replacement.received)).toEqual([[0, 30, 31]])
  })

  it('a move issued during a drag runs after the drag', async () => {
    const { broker, server } = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const dragging = broker.drag({ x: 1, y: 1 }, { x: 20, y: 20 })
    const moving = broker.move(30, 31)
    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.all([dragging, moving])

    await server.waitForReceived((received) => pointerEvents(received).length === 9)
    expect(pointerEvents(server.received)).toEqual([
      [0, 1, 1],
      [1, 1, 1],
      [1, 5, 5],
      [1, 9, 9],
      [1, 12, 12],
      [1, 16, 16],
      [1, 20, 20],
      [0, 20, 20],
      [0, 30, 31]
    ])
  })

  it('type and key report user control before validating their input', async () => {
    const { broker, openViewer } = await fixture()
    await openViewer('v1')
    broker.setOwner('user', 'v1')

    await expect(broker.type('')).rejects.toMatchObject({ code: 'desktop_user_in_control' })
    await expect(broker.key('nosuchkey')).rejects.toMatchObject({
      code: 'desktop_user_in_control'
    })
  })

  it('type and key report an unavailable desktop before validating their input', async () => {
    const broker = new DesktopBroker()

    await expect(broker.type('')).rejects.toMatchObject({
      code: 'desktop_unavailable',
      reason: 'desktop_unconfigured'
    })
    await expect(broker.key('nosuchkey')).rejects.toMatchObject({ code: 'desktop_unavailable' })
  })

  it('a queued command is refused when the user took control before it started', async () => {
    const { broker, server, openViewer } = await fixture()
    await openViewer('v1')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const dragging = broker.drag({ x: 1, y: 1 }, { x: 20, y: 20 })
    const typing = broker.type('')
    const outcomes = Promise.allSettled([dragging, typing])
    await server.waitForReceived((received) => pointerEvents(received).length === 2)
    broker.setOwner('user', 'v1')
    await vi.advanceTimersByTimeAsync(1_000)

    const [dragged, typed] = await outcomes
    expect(dragged).toMatchObject({
      status: 'rejected',
      reason: { code: 'desktop_user_in_control' }
    })
    expect(typed).toMatchObject({ status: 'rejected', reason: { code: 'desktop_user_in_control' } })
  })

  it('pointer bounds follow a resize the server announced before its pixels arrive', async () => {
    const { broker, server } = await fixture()
    server.holdUpdates()
    server.setSize(32, 24)
    await server.waitForReceived((received) =>
      received.some((m) => m[0] === 3 && m[1] === 0 && m.readUInt16BE(6) === 32)
    )

    const invalid = { code: 'desktop_invalid_input' }
    await expect(broker.move(60, 40)).rejects.toMatchObject(invalid)
    await expect(broker.click(60, 40, { button: 'left' })).rejects.toMatchObject(invalid)
    await expect(broker.drag({ x: 1, y: 1 }, { x: 60, y: 40 })).rejects.toMatchObject(invalid)
    await broker.move(30, 20)

    await server.waitForReceived((received) => pointerEvents(received).length === 1)
    expect(pointerEvents(server.received)).toEqual([[0, 30, 20]])
  })

  it('a running drag stops with desktop_invalid_input when the desktop shrinks under it', async () => {
    const { broker, server } = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const dragging = broker.drag({ x: 1, y: 1 }, { x: 60, y: 40 })
    const outcome = expect(dragging).rejects.toMatchObject({ code: 'desktop_invalid_input' })
    await server.waitForReceived((received) => pointerEvents(received).length === 2)
    server.setSize(32, 24)
    await server.waitForReceived((received) =>
      received.some((m) => m[0] === 3 && m[1] === 0 && m.readUInt16BE(6) === 32)
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await outcome

    await server.waitForReceived((received) => pointerEvents(received).length === 5)
    expect(pointerEvents(server.received)).toEqual([
      [0, 1, 1],
      [1, 1, 1],
      [1, 13, 9],
      [1, 25, 17],
      [0, 25, 17]
    ])
  })

  it('a drag aborted by a shrink releases the button inside the new bounds', async () => {
    const { broker, server } = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const dragging = broker.drag({ x: 1, y: 1 }, { x: 60, y: 40 })
    const outcome = expect(dragging).rejects.toMatchObject({ code: 'desktop_invalid_input' })
    await vi.advanceTimersByTimeAsync(10)
    await server.waitForReceived((received) => pointerEvents(received).length === 4)
    server.setSize(16, 12)
    await server.waitForReceived((received) =>
      received.some((m) => m[0] === 3 && m[1] === 0 && m.readUInt16BE(6) === 16)
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await outcome

    await server.waitForReceived((received) => pointerEvents(received).length === 5)
    expect(pointerEvents(server.received)).toEqual([
      [0, 1, 1],
      [1, 1, 1],
      [1, 13, 9],
      [1, 25, 17],
      [0, 15, 11]
    ])
  })

  it('handing control to the user after a shrink releases the held button inside the new bounds', async () => {
    const { broker, server } = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const dragging = broker.drag({ x: 1, y: 1 }, { x: 60, y: 40 })
    const outcome = expect(dragging).rejects.toMatchObject({ code: 'desktop_user_in_control' })
    await vi.advanceTimersByTimeAsync(10)
    await server.waitForReceived((received) => pointerEvents(received).length === 4)
    server.setSize(16, 12)
    await server.waitForReceived((received) =>
      received.some((m) => m[0] === 3 && m[1] === 0 && m.readUInt16BE(6) === 16)
    )
    broker.setOwner('user', 'v1')
    await vi.advanceTimersByTimeAsync(1_000)
    await outcome

    await server.waitForReceived((received) => pointerEvents(received).length === 5)
    expect(pointerEvents(server.received)).toEqual([
      [0, 1, 1],
      [1, 1, 1],
      [1, 13, 9],
      [1, 25, 17],
      [0, 15, 11]
    ])
  })
})
