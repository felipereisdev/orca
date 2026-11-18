import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcCallerIdentity } from '../../callers/rpc-caller-identity'
import { RpcDispatcher } from '../../dispatcher'
import { createSubscriptionRegistryDouble } from '../../testing/subscription-registry-test-double'
import { DesktopBroker } from '../../../../desktop/desktop-broker'
import {
  FIXTURE_PASSWORD,
  pointerEvents,
  startDesktopBrokerFixture,
  type DesktopBrokerFixture
} from '../../../../desktop/testing/desktop-broker-fixture'
import { startFakeRfbServer } from '../../../../desktop/testing/fake-rfb-server'
import { connectFakeRfbViewer } from '../../../../desktop/testing/fake-rfb-viewer'
import { createDesktopMethods } from './desktop-methods'

const PERSON: RpcCallerIdentity = { kind: 'desktop' }
const LOCAL_AGENT: RpcCallerIdentity = { kind: 'local-cli' }
const DEVICE_AGENT: RpcCallerIdentity = { kind: 'paired-device', deviceId: 'mac-1', agent: true }

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

function setup(broker: DesktopBroker) {
  const subscriptions = createSubscriptionRegistryDouble()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods only touch getRuntimeId and the subscription registry.
  const runtime = {
    getRuntimeId: () => 'runtime-env',
    ...subscriptions
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: createDesktopMethods(() => broker) })
  const call = (method: string, params: unknown, caller: RpcCallerIdentity) =>
    dispatcher.dispatch({ id: method, authToken: 't', method, params }, { caller })
  return { dispatcher, call }
}

type ViewerStream = {
  replies: { ok: boolean; result?: { type?: string; subscriptionId?: string }; error?: unknown }[]
  registerBinaryMessageHandler: ReturnType<typeof vi.fn>
  done: Promise<void>
}

/** Streams `desktop.viewer`; the RFB client sits on `client`, bytes crossing as binary frames. */
function streamViewer(
  dispatcher: RpcDispatcher,
  viewerId: string,
  caller: RpcCallerIdentity,
  client?: Duplex
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
      params: { viewerId }
    },
    (reply) => replies.push(JSON.parse(reply)),
    {
      caller,
      connectionId: 'conn-1',
      clientKind: 'runtime',
      sendBinary: (bytes) => {
        client?.write(Buffer.from(bytes))
        return true
      },
      registerBinaryMessageHandler
    }
  )
  return { replies, registerBinaryMessageHandler, done }
}

describe('desktop RPC methods', () => {
  it('desktop.configure and desktop.control.set refuse an agent caller with desktop_agent_not_allowed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const broker = new DesktopBroker()
    cleanups.push(() => broker.close())
    const { call } = setup(broker)

    const configure = await call(
      'desktop.configure',
      { host: '127.0.0.1', port: 5901, password: FIXTURE_PASSWORD },
      LOCAL_AGENT
    )
    const takeControl = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1' },
      LOCAL_AGENT
    )
    const deviceAgentTakeControl = await call(
      'desktop.control.set',
      { owner: 'user', viewerId: 'v1' },
      DEVICE_AGENT
    )

    expect(configure).toMatchObject({ ok: false, error: { code: 'desktop_agent_not_allowed' } })
    expect(takeControl).toMatchObject({ ok: false, error: { code: 'desktop_agent_not_allowed' } })
    expect(deviceAgentTakeControl).toMatchObject({
      ok: false,
      error: { code: 'desktop_agent_not_allowed' }
    })
    expect(broker.status()).toEqual({ state: 'unconfigured', owner: 'agent', recording: false })
  })

  it('desktop.viewer refuses an agent caller', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { broker } = await fixture()
    const { dispatcher } = setup(broker)

    const stream = streamViewer(dispatcher, 'v1', LOCAL_AGENT)
    await stream.done

    expect(stream.replies).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'desktop_agent_not_allowed' })
      })
    ])
    expect(stream.registerBinaryMessageHandler).not.toHaveBeenCalled()
  })

  it('desktop.viewer relays bytes between the subscription and the broker', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { broker, server } = await fixture()
    const { dispatcher, call } = setup(broker)
    let stream: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      stream = streamViewer(dispatcher, 'v1', PERSON, client)
    })
    const subscriptionId = stream!.replies[0]?.result?.subscriptionId

    const control = await call('desktop.control.set', { owner: 'user', viewerId: 'v1' }, PERSON)
    viewer.pointer(10, 11, 1)
    await server.waitForReceived((received) => pointerEvents(received).length > 0)
    const unsubscribed = await call('desktop.viewer.unsubscribe', { subscriptionId }, PERSON)
    await stream!.done

    expect(viewer).toMatchObject({ width: 64, height: 48 })
    expect(control).toMatchObject({ ok: true, result: { owner: 'user' } })
    expect(pointerEvents(server.received)).toEqual([[1, 10, 11]])
    expect(unsubscribed).toMatchObject({ ok: true, result: { unsubscribed: true } })
    expect(stream!.replies.map((reply) => reply.result?.type)).toEqual(['ready', 'end'])
  })

  it('a superseded viewer subscription ending leaves the newer viewer with the same id open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { broker, server } = await fixture()
    const { dispatcher, call } = setup(broker)
    let first: ViewerStream | undefined
    await connectFakeRfbViewer(async (client) => {
      first = streamViewer(dispatcher, 'v1', PERSON, client)
    })
    let second: ViewerStream | undefined
    const viewer = await connectFakeRfbViewer(async (client) => {
      second = streamViewer(dispatcher, 'v1', PERSON, client)
    })
    await first!.done

    await call('desktop.control.set', { owner: 'user', viewerId: 'v1' }, PERSON)
    viewer.pointer(5, 6, 1)
    await server.waitForReceived((received) => pointerEvents(received).length > 0)

    expect(pointerEvents(server.received)).toEqual([[1, 5, 6]])
    expect(second!.replies.map((reply) => reply.result?.type)).toEqual(['ready'])
  })

  it('desktop.status hides the password', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const server = await startFakeRfbServer({ password: FIXTURE_PASSWORD, width: 64, height: 48 })
    cleanups.push(() => server.close())
    const broker = new DesktopBroker()
    cleanups.push(() => broker.close())
    const { call } = setup(broker)

    const configured = await call(
      'desktop.configure',
      {
        host: '127.0.0.1',
        port: server.port,
        password: FIXTURE_PASSWORD,
        launcher: { port: 7070, token: 'launcher-token-91c2' }
      },
      PERSON
    )
    const status = await call('desktop.status', {}, PERSON)

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
