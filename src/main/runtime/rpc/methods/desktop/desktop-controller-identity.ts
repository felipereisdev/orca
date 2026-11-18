import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { DesktopError } from '../../../../desktop/desktop-errors'
import { isAgentRpcCaller } from '../../callers/rpc-caller-identity'
import type { RpcContext } from '../../core'

/** The server-stamped identity that configured a desktop; never in status or responses. */
type DesktopControllerIdentity = { kind: 'desktop' } | { kind: 'paired-device'; deviceId: string }

type CallerContext = Pick<RpcContext, 'caller' | 'pairedDeviceParentId'>

/** `bound` once a configure succeeded; `generation` names the newest configure from `identity`. */
type DesktopControllerClaim = {
  identity: DesktopControllerIdentity
  generation: number
  bound: boolean
}

// Keyed by broker so each broker (one per process in production) keeps its own claim.
const controllers = new WeakMap<DesktopBroker, DesktopControllerClaim>()

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

export type DesktopConfigureClaim = {
  /** The configure resolved: binds the caller unless a newer configure superseded this one. */
  bind(): void
  /** The configure failed: frees an unbound claim unless a newer configure is pending. */
  release(): void
}

/**
 * Claims the desktop synchronously, before the configure awaits, so another identity is refused
 * while it is pending as well as after it is bound.
 */
export function claimDesktopController(
  broker: DesktopBroker,
  ctx: CallerContext
): DesktopConfigureClaim {
  const identity = configuringIdentity(ctx)
  const current = controllers.get(broker)
  if (current && !sameIdentity(current.identity, identity)) {
    throw refused()
  }
  const claim = current ?? { identity, generation: 0, bound: false }
  const generation = ++claim.generation
  controllers.set(broker, claim)
  const isCurrent = (): boolean =>
    controllers.get(broker) === claim && claim.generation === generation
  return {
    bind: () => {
      if (isCurrent()) {
        claim.bound = true
      }
    },
    release: () => {
      if (isCurrent() && !claim.bound) {
        controllers.delete(broker)
      }
    }
  }
}

/**
 * Only the configuring identity, or a phone the server paired under that device, may view or
 * hand over the desktop. Another device on the same server (an agent can pair one) is refused.
 */
export function assertDesktopController(broker: DesktopBroker, ctx: CallerContext): void {
  const claim = controllers.get(broker)
  const bound = claim?.bound ? claim.identity : undefined
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
