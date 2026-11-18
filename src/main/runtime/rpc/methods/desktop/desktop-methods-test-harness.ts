import { CLI_AGENT_CALLER_CLIENT_CAPABILITY } from '../../../../../shared/remote-runtime/cli-agent-caller-capability'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcDispatchStreamingOptions } from '../../dispatch/dispatcher-stream-options'
import { RpcDispatcher } from '../../dispatcher'
import { createSubscriptionRegistryDouble } from '../../testing/subscription-registry-test-double'
import { DesktopBroker } from '../../../../desktop/desktop-broker'
import { FIXTURE_PASSWORD } from '../../../../desktop/testing/desktop-broker-fixture'
import type { FakeRfbServer } from '../../../../desktop/testing/fake-rfb-server'
import { createDesktopMethods, type DesktopMethodsOptions } from './desktop-methods'

export type DesktopTestTransport = Pick<
  RpcDispatchStreamingOptions,
  | 'caller'
  | 'pairedDeviceId'
  | 'pairedDeviceParentId'
  | 'clientKind'
  | 'clientCapabilities'
  | 'connectionId'
>

// Identities resolve from transport fields, as the runtime server stamps them; only IPC sets `caller`.
export const MAC: DesktopTestTransport = { pairedDeviceId: 'mac-1', clientKind: 'runtime' }
export const MAC_AGENT: DesktopTestTransport = {
  pairedDeviceId: 'mac-1',
  clientKind: 'runtime',
  clientCapabilities: [CLI_AGENT_CALLER_CLIENT_CAPABILITY]
}
export const LOCAL_AGENT: DesktopTestTransport = {}

export type DesktopReply = {
  ok: boolean
  result?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

let connectionCount = 0

/** A dispatcher serving only the desktop methods over `broker`. */
export function createDesktopRpcHarness(
  broker: DesktopBroker = new DesktopBroker(),
  options: DesktopMethodsOptions = {}
) {
  const subscriptions = createSubscriptionRegistryDouble()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods only touch getRuntimeId and the subscription registry.
  const runtime = {
    getRuntimeId: () => 'runtime-env',
    ...subscriptions
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: createDesktopMethods(() => broker, options)
  })
  const call = async (
    method: string,
    params: unknown,
    transport: DesktopTestTransport
  ): Promise<DesktopReply> =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dispatch returns the JSON-RPC envelope these tests read.
    (await dispatcher.dispatch(
      { id: method, authToken: 't', method, params },
      transport
    )) as unknown as DesktopReply
  const configure = (
    server: FakeRfbServer,
    transport: DesktopTestTransport,
    launcher?: { port: number; token: string }
  ) =>
    call(
      'desktop.configure',
      { host: '127.0.0.1', port: server.port, password: FIXTURE_PASSWORD, launcher },
      transport
    )
  /** Streams `method` on its own connection; `replies` fills as events arrive. */
  const stream = (
    method: string,
    params: unknown,
    transport: DesktopTestTransport,
    signal?: AbortSignal
  ) => {
    const connectionId = `conn-${++connectionCount}`
    const replies: DesktopReply[] = []
    const waiters = new Set<{ predicate: (replies: DesktopReply[]) => boolean; resolve(): void }>()
    const done = dispatcher.dispatchStreaming(
      { id: method, authToken: 't', method, params },
      (reply) => {
        replies.push(JSON.parse(reply))
        for (const waiter of waiters) {
          if (waiter.predicate(replies)) {
            waiters.delete(waiter)
            waiter.resolve()
          }
        }
      },
      { ...transport, connectionId, signal }
    )
    /** Resolves once `replies` satisfies `predicate`; event-driven, so tests never poll. */
    const waitForReplies = (predicate: (replies: DesktopReply[]) => boolean): Promise<void> =>
      predicate(replies)
        ? Promise.resolve()
        : new Promise((resolve) => waiters.add({ predicate, resolve }))
    return { replies, done, connectionId, waitForReplies }
  }
  return { broker, dispatcher, runtime, subscriptions, call, configure, stream }
}
