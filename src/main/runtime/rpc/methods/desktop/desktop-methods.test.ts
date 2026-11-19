import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcDispatcher } from '../../dispatcher'
import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { DesktopError } from '../../../../desktop/desktop-errors'
import { FIXTURE_PASSWORD, pointerEvents } from '../../../../desktop/testing/desktop-broker-fixture'
import { startFakeRfbServer, type FakeRfbServer } from '../../../../desktop/testing/fake-rfb-server'
import { connectFakeRfbViewer } from '../../../../desktop/testing/fake-rfb-viewer'
import {
  createDesktopRpcHarness,
  LOCAL_AGENT,
  MAC,
  MAC_AGENT,
  type DesktopTestTransport as Transport
} from './desktop-methods-test-harness'

const OTHER_MAC: Transport = { pairedDeviceId: 'mac-2', clientKind: 'runtime' }
const MAC_PHONE: Transport = {
  pairedDeviceId: 'phone-1',
  pairedDeviceParentId: 'mac-1',
  clientKind: 'mobile'
}
const OTHER_PHONE: Transport = {
  pairedDeviceId: 'phone-2',
  pairedDeviceParentId: 'mac-2',
  clientKind: 'mobile'
}
const HOST_WINDOW: Transport = { caller: { kind: 'desktop' } }

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function vncServer(): Promise<FakeRfbServer> {
  const server = await startFakeRfbServer({ password: FIXTURE_PASSWORD, width: 64, height: 48 })
  cleanups.push(() => server.close())
  return server
}

function setup() {
  const harness = createDesktopRpcHarness()
  cleanups.push(() => harness.broker.close())
  return harness
}

type ViewerStream = {
  replies: { ok: boolean; result?: { type?: string; subscriptionId?: string }; error?: unknown }[]
  registerBinaryMessageHandler: ReturnType<typeof vi.fn>
  done: Promise<void>
}

let connectionCount = 0

/** Streams `desktop.viewer` on its own connection; the RFB client sits on `client`. */
function streamViewer(
  dispatcher: RpcDispatcher,
  viewerId: string,
  transport: Transport,
  client?: Duplex,
  controllerToken?: string
): ViewerStream {
  const replies: ViewerStream['replies'] = []
  const registerBinaryMessageHandler = vi.fn((handler: (bytes: Uint8Array) => void) => {
    const forward = (chunk: Buffer): void => handler(new Uint8Array(chunk))
    client?.on('data', forward)
    return () => client?.off('data', forward)
  })
  const done = dispatcher.dispatchStreaming(
    {
      id: `viewer-${viewerId}`,
      authToken: 't',
      method: 'desktop.viewer',
      params: { viewerId, controllerToken }
    },
    (reply) => replies.push(JSON.parse(reply)),
    {
      ...transport,
      connectionId: `conn-${++connectionCount}`,
      sendBinary: (bytes) => {
        client?.write(Buffer.from(bytes))
        return true
      },
      registerBinaryMessageHandler
    }
  )
  return { replies, registerBinaryMessageHandler, done }
}

const refused = { ok: false, error: { code: 'desktop_agent_not_allowed' } }

describe('desktop RPC methods', () => {
  it('desktop.configure and desktop.control.set refuse an agent caller with desktop_agent_not_allowed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { broker, call, configure, token } = setup()

    const localConfigure = await configure(server, LOCAL_AGENT)
    const markedConfigure = await configure(server, MAC_AGENT)
    await configure(server, MAC)
    const localControl = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1', controllerToken: token() },
      LOCAL_AGENT
    )
    const markedControl = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1', controllerToken: token() },
      MAC_AGENT
    )

    expect(localConfigure).toMatchObject(refused)
    expect(markedConfigure).toMatchObject(refused)
    expect(localControl).toMatchObject(refused)
    expect(markedControl).toMatchObject(refused)
    expect(broker.status().owner).toBe('agent')
  })

  it('the configuring identity without the controller token cannot view, take control or reconfigure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { broker, dispatcher, call, configure, token } = setup()
    // An agent on the environment holds the same paired credential, but never the VNC password.
    await configure(server, MAC)
    const hostToken = token()

    const noToken = streamViewer(dispatcher, 'v1', MAC)
    await noToken.done
    const forged = streamViewer(dispatcher, 'v1', MAC, undefined, 'A'.repeat(43))
    await forged.done
    const control = await call('desktop.control.set', { owner: 'user', viewerId: 'v1' }, MAC)
    const reconfigure = await configure(server, MAC, undefined, 'guessed1')

    const tokenRefused = { ok: false, error: { code: 'desktop_controller_token_invalid' } }
    expect(noToken.replies).toMatchObject([tokenRefused])
    expect(forged.replies).toMatchObject([tokenRefused])
    expect(noToken.registerBinaryMessageHandler).not.toHaveBeenCalled()
    expect(control).toMatchObject(tokenRefused)
    expect(reconfigure).toMatchObject({
      ok: false,
      error: { code: 'desktop_unavailable', message: expect.stringContaining('rfb_auth_failed') }
    })
    expect(JSON.stringify(reconfigure)).not.toContain('controllerToken')
    expect(broker.status()).toMatchObject({ state: 'ready', owner: 'agent' })
    // The host's token still works after the refused attempts.
    const handover = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1', controllerToken: hostToken },
      MAC
    )
    expect(handover).toMatchObject({ ok: true, result: { owner: 'user' } })
  })

  it('a configure with the wrong VNC password changes nothing and binds no one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { broker, configure } = setup()

    const wrong = await configure(server, MAC, undefined, 'guessed1')
    const statusAfter = broker.status()
    const other = await configure(server, OTHER_MAC)

    // The reason tells the host this is not worth retrying on a schedule, unlike an unreachable VNC.
    expect(wrong).toMatchObject({
      ok: false,
      error: { code: 'desktop_unavailable', data: { reason: 'rfb_auth_failed' } }
    })
    expect(statusAfter).toMatchObject({ state: 'unconfigured' })
    // No claim was left behind, so the identity that does hold the password can configure.
    expect(other).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(other.result?.controllerToken).toEqual(expect.any(String))
  })

  it('every successful configure answers with a fresh token and retires the previous one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { call, configure } = setup()

    const first = await configure(server, MAC)
    const second = await configure(server, MAC)
    const take = (reply: typeof first) =>
      call(
        'desktop.control.set',
        { owner: 'user', viewerId: 'v1', controllerToken: reply.result?.controllerToken },
        MAC
      )

    expect(second.result?.controllerToken).not.toEqual(first.result?.controllerToken)
    expect(await take(first)).toMatchObject({
      ok: false,
      error: { code: 'desktop_controller_token_invalid' }
    })
    expect(await take(second)).toMatchObject({ ok: true })
  })

  it('desktop.viewer refuses an agent caller', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, configure, token } = setup()
    await configure(server, MAC)

    const stream = streamViewer(dispatcher, 'v1', MAC_AGENT, undefined, token())
    await stream.done

    expect(stream.replies).toMatchObject([refused])
    expect(stream.registerBinaryMessageHandler).not.toHaveBeenCalled()
  })

  it('a second paired device cannot open a viewer, set control or end a viewer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { broker, dispatcher, call, configure, token } = setup()
    await configure(server, MAC)
    let own: ViewerStream | undefined
    await connectFakeRfbViewer(async (client) => {
      own = streamViewer(dispatcher, 'v1', MAC, client, token())
    })
    const subscriptionId = own!.replies[0]?.result?.subscriptionId

    const stranger = streamViewer(dispatcher, 'v2', OTHER_MAC, undefined, token())
    await stranger.done
    const strangersPhone = streamViewer(dispatcher, 'v3', OTHER_PHONE, undefined, token())
    await strangersPhone.done
    const control = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v2', controllerToken: token() },
      OTHER_MAC
    )
    const unsubscribe = await call('desktop.viewer.unsubscribe', { subscriptionId }, OTHER_MAC)

    expect(stranger.replies).toMatchObject([refused])
    expect(stranger.registerBinaryMessageHandler).not.toHaveBeenCalled()
    expect(strangersPhone.replies).toMatchObject([refused])
    expect(control).toMatchObject(refused)
    expect(unsubscribe).toMatchObject(refused)
    expect(broker.status().owner).toBe('agent')
    expect(own!.replies.map((reply) => reply.result?.type)).toEqual(['ready'])
  })

  it('desktop.viewer relays bytes between the subscription and the broker for the configuring device', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, call, configure, token } = setup()
    await configure(server, MAC)
    let stream: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      stream = streamViewer(dispatcher, 'v1', MAC, client, token())
    })
    const subscriptionId = stream!.replies[0]?.result?.subscriptionId

    const control = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1', controllerToken: token() },
      MAC
    )
    viewer.pointer(10, 11, 1)
    await server.waitForReceived((received) => pointerEvents(received).length > 0)
    const unsubscribed = await call('desktop.viewer.unsubscribe', { subscriptionId }, MAC)
    await stream!.done

    expect(viewer).toMatchObject({ width: 64, height: 48 })
    expect(control).toMatchObject({ ok: true, result: { owner: 'user' } })
    expect(pointerEvents(server.received)).toEqual([[1, 10, 11]])
    expect(unsubscribed).toMatchObject({ ok: true, result: { unsubscribed: true } })
    expect(stream!.replies.map((reply) => reply.result?.type)).toEqual(['ready', 'end'])
  })

  it("the configuring device's paired phone can view and take control", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, call, configure, token } = setup()
    await configure(server, MAC)
    let stream: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      stream = streamViewer(dispatcher, 'p1', MAC_PHONE, client, token())
    })

    const control = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'p1', controllerToken: token() },
      MAC_PHONE
    )
    viewer.pointer(7, 8, 1)
    await server.waitForReceived((received) => pointerEvents(received).length > 0)

    expect(control).toMatchObject({ ok: true, result: { owner: 'user' } })
    expect(pointerEvents(server.received)).toEqual([[1, 7, 8]])
    expect(stream!.replies.map((reply) => reply.result?.type)).toEqual(['ready'])
  })

  it('configure from a different identity is refused, and from the same device is accepted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { call, configure } = setup()

    const first = await configure(server, MAC)
    const otherDevice = await configure(server, OTHER_MAC)
    const otherPhone = await configure(server, MAC_PHONE)
    const hostWindow = await configure(server, HOST_WINDOW)
    const again = await configure(server, MAC)
    const status = await call('desktop.status', {}, MAC)

    expect(first).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(otherDevice).toMatchObject(refused)
    expect(otherPhone).toMatchObject(refused)
    expect(hostWindow).toMatchObject(refused)
    expect(again).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(JSON.stringify(status)).not.toContain('mac-1')
  })

  it('a host window that configured the desktop can view it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, configure, token } = setup()
    await configure(server, HOST_WINDOW)

    const viewer = await connectFakeRfbViewer(async (client) => {
      streamViewer(dispatcher, 'w1', HOST_WINDOW, client, token())
    })
    const device = streamViewer(dispatcher, 'v2', MAC, undefined, token())
    await device.done

    expect(viewer).toMatchObject({ width: 64, height: 48 })
    expect(device.replies).toMatchObject([refused])
  })

  it('a superseded viewer subscription ending leaves the newer viewer with the same id open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, call, configure, token } = setup()
    await configure(server, MAC)
    let first: ViewerStream | undefined
    await connectFakeRfbViewer(async (client) => {
      first = streamViewer(dispatcher, 'v1', MAC, client, token())
    })
    let second: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      second = streamViewer(dispatcher, 'v1', MAC, client, token())
    })
    await first!.done

    await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1', controllerToken: token() },
      MAC
    )
    viewer.pointer(5, 6, 1)
    await server.waitForReceived((received) => pointerEvents(received).length > 0)

    expect(pointerEvents(server.received)).toEqual([[1, 5, 6]])
    expect(second!.replies.map((reply) => reply.result?.type)).toEqual(['ready'])
  })

  it("desktop.status with a viewerId says whether that viewer holds control, never another viewer's id", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, call, configure, token } = setup()
    await configure(server, MAC)
    await connectFakeRfbViewer(async (client) => {
      streamViewer(dispatcher, 'v1', MAC, client, token())
    })
    await connectFakeRfbViewer(async (client) => {
      streamViewer(dispatcher, 'v2', MAC, client, token())
    })

    const agentOwned = await call('desktop.status', { viewerId: 'v1' }, MAC)
    await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1', controllerToken: token() },
      MAC
    )
    const mine = await call('desktop.status', { viewerId: 'v1' }, MAC)
    const other = await call('desktop.status', { viewerId: 'v2' }, MAC)
    const plain = await call('desktop.status', {}, MAC)

    expect(agentOwned).toMatchObject({ result: { owner: 'agent', viewerControl: null } })
    expect(mine).toMatchObject({ result: { owner: 'user', viewerControl: 'this' } })
    expect(other).toMatchObject({ result: { owner: 'user', viewerControl: 'other' } })
    expect(plain).toMatchObject({ ok: true })
    expect(plain).not.toHaveProperty('result.viewerControl')
    expect(JSON.stringify([mine, other, plain])).not.toContain('v1')
  })

  it('desktop.status hides the password', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { call } = setup()

    const configured = await call(
      'desktop.configure',
      {
        host: '127.0.0.1',
        port: server.port,
        password: FIXTURE_PASSWORD,
        launcher: { port: 7070, token: 'launcher-token-91c2' }
      },
      MAC
    )
    const status = await call('desktop.status', {}, MAC)

    expect(status).toMatchObject({
      ok: true,
      result: { state: 'ready', owner: 'agent', width: 64, height: 48, recording: false }
    })
    for (const response of [configured, status]) {
      expect(JSON.stringify(response)).not.toContain(FIXTURE_PASSWORD)
      expect(JSON.stringify(response)).not.toContain('launcher-token-91c2')
    }
  })

  describe('concurrent configure', () => {
    /** Each broker.configure call waits until the test settles it; `reached(n)` awaits the nth call. */
    function deferConfigure(broker: DesktopBroker) {
      const calls: { resolve: () => void; reject: (error: unknown) => void }[] = []
      const waiters: { count: number; resolve: () => void }[] = []
      // The password is proven here; these cases are about the claim around the configure.
      vi.spyOn(broker, 'verifyCredentials').mockResolvedValue()
      vi.spyOn(broker, 'configure').mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            calls.push({ resolve, reject })
            for (const waiter of waiters.filter((entry) => entry.count <= calls.length)) {
              waiter.resolve()
            }
          })
      )
      const reached = async (count: number) => {
        if (calls.length < count) {
          await new Promise<void>((resolve) => waiters.push({ count, resolve }))
        }
        return calls[count - 1]
      }
      return { calls, reached }
    }
    const VNC = { host: '127.0.0.1', port: 5901, password: FIXTURE_PASSWORD }
    const takeControl = (reply: { result?: Record<string, unknown> }) => ({
      owner: 'user',
      viewerId: 'v1',
      controllerToken: reply.result?.controllerToken
    })

    it('refuses a second identity while the first configure is still pending', async () => {
      const { broker, call } = setup()
      const configure = deferConfigure(broker)

      const first = call('desktop.configure', VNC, MAC)
      const firstCall = await configure.reached(1)
      const second = await call('desktop.configure', VNC, OTHER_MAC)
      firstCall.resolve()
      const configured = await first

      expect(second).toMatchObject(refused)
      expect(configure.calls).toHaveLength(1)
      expect(await call('desktop.control.set', takeControl(configured), MAC)).toMatchObject({
        ok: true
      })
      expect(await call('desktop.control.set', takeControl(configured), OTHER_MAC)).toMatchObject(
        refused
      )
    })

    it('keeps the claim when an identity supersedes its own pending configure and the older one fails', async () => {
      const { broker, call } = setup()
      const configure = deferConfigure(broker)

      const older = call('desktop.configure', VNC, MAC)
      const olderCall = await configure.reached(1)
      const newer = call('desktop.configure', VNC, MAC)
      const newerCall = await configure.reached(2)
      olderCall.reject(new DesktopError('desktop_invalid_input'))
      await older
      const stranger = await call('desktop.configure', VNC, OTHER_MAC)
      newerCall.resolve()
      const configured = await newer

      expect(stranger).toMatchObject(refused)
      expect(await call('desktop.control.set', takeControl(configured), MAC)).toMatchObject({
        ok: true
      })
    })

    it('releases the claim when the first configure fails, so another identity can configure', async () => {
      const { broker, call } = setup()
      const configure = deferConfigure(broker)

      const failed = call('desktop.configure', VNC, MAC)
      ;(await configure.reached(1)).reject(new DesktopError('desktop_invalid_input'))
      const failure = await failed
      const other = call('desktop.configure', VNC, OTHER_MAC)
      ;(await configure.reached(2)).resolve()

      const configured = await other
      expect(failure).toMatchObject({ ok: false, error: { code: 'desktop_invalid_input' } })
      expect(configured).toMatchObject({ ok: true })
      expect(await call('desktop.control.set', takeControl(configured), OTHER_MAC)).toMatchObject({
        ok: true
      })
      expect(await call('desktop.control.set', takeControl(configured), MAC)).toMatchObject(refused)
    })
  })
})
