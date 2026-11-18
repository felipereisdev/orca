import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_AGENT_CALLER_CLIENT_CAPABILITY } from '../../../../../shared/remote-runtime/cli-agent-caller-capability'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcDispatchStreamingOptions } from '../../dispatch/dispatcher-stream-options'
import { RpcDispatcher } from '../../dispatcher'
import { createSubscriptionRegistryDouble } from '../../testing/subscription-registry-test-double'
import { DesktopBroker } from '../../../../desktop/desktop-broker'
import { FIXTURE_PASSWORD, pointerEvents } from '../../../../desktop/testing/desktop-broker-fixture'
import { startFakeRfbServer, type FakeRfbServer } from '../../../../desktop/testing/fake-rfb-server'
import { connectFakeRfbViewer } from '../../../../desktop/testing/fake-rfb-viewer'
import { createDesktopMethods } from './desktop-methods'

type Transport = Pick<
  RpcDispatchStreamingOptions,
  'caller' | 'pairedDeviceId' | 'pairedDeviceParentId' | 'clientKind' | 'clientCapabilities'
>

// Identities resolve from transport fields, as the runtime server stamps them; only IPC sets `caller`.
const MAC: Transport = { pairedDeviceId: 'mac-1', clientKind: 'runtime' }
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
const MAC_AGENT: Transport = {
  pairedDeviceId: 'mac-1',
  clientKind: 'runtime',
  clientCapabilities: [CLI_AGENT_CALLER_CLIENT_CAPABILITY]
}
const LOCAL_AGENT: Transport = {}
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
  const broker = new DesktopBroker()
  cleanups.push(() => broker.close())
  const subscriptions = createSubscriptionRegistryDouble()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods only touch getRuntimeId and the subscription registry.
  const runtime = {
    getRuntimeId: () => 'runtime-env',
    ...subscriptions
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: createDesktopMethods(() => broker) })
  const call = (method: string, params: unknown, transport: Transport) =>
    dispatcher.dispatch({ id: method, authToken: 't', method, params }, transport)
  const configure = (server: FakeRfbServer, transport: Transport) =>
    call(
      'desktop.configure',
      { host: '127.0.0.1', port: server.port, password: FIXTURE_PASSWORD },
      transport
    )
  return { broker, dispatcher, call, configure }
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
  client?: Duplex
): ViewerStream {
  const replies: ViewerStream['replies'] = []
  const registerBinaryMessageHandler = vi.fn((handler: (bytes: Uint8Array) => void) => {
    const forward = (chunk: Buffer): void => handler(new Uint8Array(chunk))
    client?.on('data', forward)
    return () => client?.off('data', forward)
  })
  const done = dispatcher.dispatchStreaming(
    { id: `viewer-${viewerId}`, authToken: 't', method: 'desktop.viewer', params: { viewerId } },
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
    const { broker, call, configure } = setup()

    const localConfigure = await configure(server, LOCAL_AGENT)
    const markedConfigure = await configure(server, MAC_AGENT)
    await configure(server, MAC)
    const localControl = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1' },
      LOCAL_AGENT
    )
    const markedControl = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1' },
      MAC_AGENT
    )

    expect(localConfigure).toMatchObject(refused)
    expect(markedConfigure).toMatchObject(refused)
    expect(localControl).toMatchObject(refused)
    expect(markedControl).toMatchObject(refused)
    expect(broker.status().owner).toBe('agent')
  })

  it('desktop.viewer refuses an agent caller', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, configure } = setup()
    await configure(server, MAC)

    const stream = streamViewer(dispatcher, 'v1', MAC_AGENT)
    await stream.done

    expect(stream.replies).toMatchObject([refused])
    expect(stream.registerBinaryMessageHandler).not.toHaveBeenCalled()
  })

  it('a second paired device cannot open a viewer, set control or end a viewer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { broker, dispatcher, call, configure } = setup()
    await configure(server, MAC)
    let own: ViewerStream | undefined
    await connectFakeRfbViewer(async (client) => {
      own = streamViewer(dispatcher, 'v1', MAC, client)
    })
    const subscriptionId = own!.replies[0]?.result?.subscriptionId

    const stranger = streamViewer(dispatcher, 'v2', OTHER_MAC)
    await stranger.done
    const strangersPhone = streamViewer(dispatcher, 'v3', OTHER_PHONE)
    await strangersPhone.done
    const control = await call('desktop.control.set', { owner: 'user', viewerId: 'v2' }, OTHER_MAC)
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
    const { dispatcher, call, configure } = setup()
    await configure(server, MAC)
    let stream: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      stream = streamViewer(dispatcher, 'v1', MAC, client)
    })
    const subscriptionId = stream!.replies[0]?.result?.subscriptionId

    const control = await call('desktop.control.set', { owner: 'user', viewerId: 'v1' }, MAC)
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
    const { dispatcher, call, configure } = setup()
    await configure(server, MAC)
    let stream: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      stream = streamViewer(dispatcher, 'p1', MAC_PHONE, client)
    })

    const control = await call('desktop.control.set', { owner: 'user', viewerId: 'p1' }, MAC_PHONE)
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
    const { dispatcher, configure } = setup()
    await configure(server, HOST_WINDOW)

    const viewer = await connectFakeRfbViewer(async (client) => {
      streamViewer(dispatcher, 'w1', HOST_WINDOW, client)
    })
    const device = streamViewer(dispatcher, 'v2', MAC)
    await device.done

    expect(viewer).toMatchObject({ width: 64, height: 48 })
    expect(device.replies).toMatchObject([refused])
  })

  it('a superseded viewer subscription ending leaves the newer viewer with the same id open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await vncServer()
    const { dispatcher, call, configure } = setup()
    await configure(server, MAC)
    let first: ViewerStream | undefined
    await connectFakeRfbViewer(async (client) => {
      first = streamViewer(dispatcher, 'v1', MAC, client)
    })
    let second: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      second = streamViewer(dispatcher, 'v1', MAC, client)
    })
    await first!.done

    await call('desktop.control.set', { owner: 'user', viewerId: 'v1' }, MAC)
    viewer.pointer(5, 6, 1)
    await server.waitForReceived((received) => pointerEvents(received).length > 0)

    expect(pointerEvents(server.received)).toEqual([[1, 5, 6]])
    expect(second!.replies.map((reply) => reply.result?.type)).toEqual(['ready'])
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
})
