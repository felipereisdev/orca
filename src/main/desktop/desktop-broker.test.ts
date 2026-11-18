import { duplexPair } from 'node:stream'
import { inspect } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopBroker } from './desktop-broker'
import {
  FIXTURE_PASSWORD,
  startDesktopBrokerFixture,
  type DesktopBrokerFixture
} from './testing/desktop-broker-fixture'
import { startFakeRfbServer } from './testing/fake-rfb-server'
import { startStalledTcpServer } from './testing/stalled-tcp-server'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function fixture(size?: { width: number; height: number }): Promise<DesktopBrokerFixture> {
  const started = await startDesktopBrokerFixture(size)
  cleanups.push(() => started.close())
  return started
}

function trackedBroker(): DesktopBroker {
  const broker = new DesktopBroker()
  cleanups.push(() => broker.close())
  return broker
}

describe('DesktopBroker connection', () => {
  it('configure connects and status becomes ready with the server size', async () => {
    const { broker } = await fixture({ width: 64, height: 48 })

    expect(broker.status()).toEqual({
      state: 'ready',
      owner: 'agent',
      width: 64,
      height: 48,
      recording: false
    })
  })

  it('wrong password → status unavailable with reason rfb_auth_failed, retried on next configure', async () => {
    const server = await startFakeRfbServer({ password: 'right-pw', width: 32, height: 24 })
    cleanups.push(() => server.close())
    const broker = trackedBroker()

    await broker.configure({ host: '127.0.0.1', port: server.port, password: 'wrong-pw' })
    expect(broker.status()).toMatchObject({ state: 'unavailable', reason: 'rfb_auth_failed' })

    await broker.configure({ host: '127.0.0.1', port: server.port, password: 'right-pw' })
    expect(broker.status()).toMatchObject({ state: 'ready', width: 32, height: 24 })
  })

  it('a VNC server that stalls the handshake is given up on after 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stalled = await startStalledTcpServer()
    cleanups.push(() => stalled.close())
    const broker = trackedBroker()

    const configuring = broker.configure({ host: '127.0.0.1', port: stalled.port, password: 'x' })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(broker.status().state).toBe('connecting')
    await vi.advanceTimersByTimeAsync(1)
    await configuring

    expect(broker.status()).toMatchObject({ state: 'unavailable', reason: 'desktop_vnc_timeout' })
  })

  it('an unreachable VNC server is retried with backoff until it listens', async () => {
    const probe = await startFakeRfbServer({ password: FIXTURE_PASSWORD, width: 16, height: 8 })
    const port = probe.port
    await probe.close()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const broker = trackedBroker()

    await broker.configure({ host: '127.0.0.1', port, password: FIXTURE_PASSWORD })
    expect(broker.status()).toMatchObject({
      state: 'unavailable',
      reason: 'desktop_vnc_unreachable'
    })

    const server = await startFakeRfbServer({
      password: FIXTURE_PASSWORD,
      width: 16,
      height: 8,
      port
    })
    cleanups.push(() => server.close())
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(broker.status()).toMatchObject({ state: 'ready', width: 16 }))
  })

  it('a viewer that never answers the handshake is dropped after 10 s', async () => {
    const { broker } = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const [brokerSide] = duplexPair()

    const opening = broker.openViewer('silent', brokerSide)
    const outcome = expect(opening).rejects.toMatchObject({ code: 'desktop_unavailable' })
    await vi.advanceTimersByTimeAsync(10_000)

    await outcome
    expect(brokerSide.destroyed).toBe(true)
  })

  it('screenshot returns a PNG of the server size', async () => {
    const { broker } = await fixture({ width: 40, height: 30 })

    const shot = await broker.screenshot()

    expect(shot).toMatchObject({ width: 40, height: 30 })
    expect(shot.png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    expect(shot.png.readUInt32BE(16)).toBe(40)
    expect(shot.png.readUInt32BE(20)).toBe(30)
  })

  it('server DesktopSize keeps viewers and the control framebuffer in sync', async () => {
    const { broker, server, openViewer } = await fixture({ width: 64, height: 48 })
    const viewer = await openViewer('v1')
    viewer.setEncodings([0, -223])
    viewer.requestUpdate(false, 64, 48)
    expect(await viewer.readUpdate()).toEqual([{ x: 0, y: 0, width: 64, height: 48, encoding: 0 }])
    viewer.requestUpdate(true, 64, 48)
    const frames: [number, number][] = []
    const resized = new Promise<void>((resolve) => {
      broker.onFrame((fb) => {
        frames.push([fb.width, fb.height])
        if (fb.width === 80) {
          resolve()
        }
      })
    })

    server.setSize(80, 60)

    expect(await viewer.readUpdate()).toEqual([
      { x: 0, y: 0, width: 80, height: 60, encoding: -223 }
    ])
    await resized
    expect(broker.status()).toMatchObject({ state: 'ready', width: 80, height: 60 })
    await server.waitForReceived((received) =>
      received.some((m) => m[0] === 3 && m[1] === 0 && m.readUInt16BE(6) === 80)
    )
    const shot = await broker.screenshot()
    expect(shot).toMatchObject({ width: 80, height: 60 })
  })

  it('password never appears in status() or thrown error messages', async () => {
    const secret = 'Zq9-secret-pw'
    const server = await startFakeRfbServer({ password: 'other', width: 16, height: 8 })
    cleanups.push(() => server.close())
    const broker = trackedBroker()
    await broker.configure({ host: '127.0.0.1', port: server.port, password: secret })

    const errors = await Promise.all([
      broker.click(1, 1, { button: 'left' }).catch((error: unknown) => error),
      broker.screenshot().catch((error: unknown) => error),
      broker.openViewer('v1', duplexPair()[0]).catch((error: unknown) => error)
    ])

    for (const error of errors) {
      expect(error).toMatchObject({ code: 'desktop_unavailable' })
      expect(inspect(error)).not.toContain(secret)
    }
    expect(JSON.stringify(broker.status())).not.toContain(secret)
    expect(inspect(broker, { depth: 10, showHidden: true })).not.toContain(secret)
  })
})
