import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { DesktopError } from '../../../../desktop/desktop-errors'
import { isAgentRpcCaller } from '../../callers/rpc-caller-identity'
import type { RpcContext } from '../../core'

/** The server-stamped identity that configured a desktop; never in status or responses. */
type DesktopControllerIdentity = { kind: 'desktop' } | { kind: 'paired-device'; deviceId: string }

type CallerContext = Pick<RpcContext, 'caller' | 'pairedDeviceParentId'>

// Keyed by broker so each broker (one per process in production) keeps its own binding.
const controllers = new WeakMap<DesktopBroker, DesktopControllerIdentity>()

function refused(): DesktopError {
  return new DesktopError('desktop_agent_not_allowed')
}

/** The caller's own identity, if it may ever configure: a person's host window or a paired device. */
function configuringIdentity({ caller }: CallerContext): DesktopControllerIdentity {
  // The agent marker is self-declared; it only ever narrows what a caller may do.
  if (isAgentRpcCaller(caller)) {
    throw refused()
  }
  if (caller?.kind === 'desktop') {
    return { kind: 'desktop' }
  }
  if (caller?.kind === 'paired-device') {
    return { kind: 'paired-device', deviceId: caller.deviceId }
  }
  throw refused()
}

function sameIdentity(a: DesktopControllerIdentity, b: DesktopControllerIdentity): boolean {
  if (a.kind === 'desktop' || b.kind === 'desktop') {
    return a.kind === b.kind
  }
  return a.deviceId === b.deviceId
}

/**
 * Refuses anyone but the identity already bound; the returned `bind` records the caller once
 * its configure succeeded, so a rejected configure binds no one.
 */
export function claimDesktopController(broker: DesktopBroker, ctx: CallerContext): () => void {
  const identity = configuringIdentity(ctx)
  const bound = controllers.get(broker)
  if (bound && !sameIdentity(bound, identity)) {
    throw refused()
  }
  return () => controllers.set(broker, identity)
}

/**
 * Only the configuring identity, or a phone the server paired under that device, may view or
 * hand over the desktop. Another device on the same server (an agent can pair one) is refused.
 */
export function assertDesktopController(broker: DesktopBroker, ctx: CallerContext): void {
  const bound = controllers.get(broker)
  const { caller } = ctx
  if (!bound || !caller || isAgentRpcCaller(caller)) {
    throw refused()
  }
  if (caller.kind === 'desktop' && bound.kind === 'desktop') {
    return
  }
  if (
    caller.kind === 'paired-device' &&
    bound.kind === 'paired-device' &&
    (caller.deviceId === bound.deviceId || ctx.pairedDeviceParentId === bound.deviceId)
  ) {
    return
  }
  throw refused()
}
