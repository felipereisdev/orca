import type { Duplex } from 'node:stream'
import {
  agentClick,
  agentDrag,
  agentKey,
  agentMove,
  agentScroll,
  agentType,
  type AgentInputSink,
  type DesktopButton,
  type DesktopPoint
} from './desktop-agent-actions'
import { DesktopControlConnection } from './desktop-control-connection'
import { DesktopError } from './desktop-errors'
import { desktopFailureReason, type DesktopVncTarget } from './desktop-upstream'
import { DesktopViewerSession } from './desktop-viewer-session'
import { encodePng } from './rfb/png-encode'
import type { RfbFramebuffer } from './rfb/rfb-framebuffer'

export type DesktopOwner = 'agent' | 'user'

export type DesktopStatus = {
  state: 'unconfigured' | 'connecting' | 'ready' | 'unavailable'
  reason?: string
  owner: DesktopOwner
  width?: number
  height?: number
  recording: boolean
}

export type DesktopBrokerConfig = {
  host: string
  port: number
  password: string
  launcher?: { port: number; token: string }
}

const OWNER_FALLBACK_MS = 5_000
const RETRY_INITIAL_MS = 1_000
const RETRY_MAX_MS = 30_000

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

function assertValidConfig(cfg: DesktopBrokerConfig): void {
  if (typeof cfg.host !== 'string' || cfg.host.length === 0 || !validPort(cfg.port)) {
    throw new DesktopError('desktop_invalid_input', 'host and port are required')
  }
  if (typeof cfg.password !== 'string' || cfg.password.length === 0) {
    throw new DesktopError('desktop_invalid_input', 'a VNC password is required')
  }
  if (cfg.launcher && (!validPort(cfg.launcher.port) || typeof cfg.launcher.token !== 'string')) {
    throw new DesktopError('desktop_invalid_input', 'launcher needs a port and a token')
  }
}

/**
 * The only VNC client in the environment. Credentials live in private fields and never reach
 * status, errors or logs. The agent acts through one control connection; each viewer gets its
 * own upstream connection whose input passes only while that viewer holds control.
 */
export class DesktopBroker {
  #target: DesktopVncTarget | undefined
  #launcher: { port: number; token: string } | undefined
  #generation = 0
  #state: DesktopStatus['state'] = 'unconfigured'
  #reason: string | undefined
  #control: DesktopControlConnection | undefined
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #retryDelayMs = RETRY_INITIAL_MS
  #owner: DesktopOwner = 'agent'
  #controller: string | undefined
  #fallbackTimer: ReturnType<typeof setTimeout> | undefined
  readonly #viewers = new Map<string, DesktopViewerSession>()
  readonly #frameListeners = new Set<(fb: RfbFramebuffer) => void>()
  readonly #agentInput: AgentInputSink = {
    send: (message) => this.#readyControl().write(message),
    size: () => this.#readyControl().framebuffer
  }

  /** Replaces any previous configuration and reconnects; resolves after the first attempt. */
  async configure(cfg: DesktopBrokerConfig): Promise<void> {
    assertValidConfig(cfg)
    this.#disconnect()
    this.#target = { host: cfg.host, port: cfg.port, password: cfg.password }
    this.#launcher = cfg.launcher ? { ...cfg.launcher } : undefined
    this.#state = 'connecting'
    this.#reason = undefined
    this.#retryDelayMs = RETRY_INITIAL_MS
    await this.#connect(this.#generation)
  }

  /** Drops the configuration, every connection and timer. */
  close(): void {
    this.#disconnect()
    this.#target = undefined
    this.#launcher = undefined
    this.#state = 'unconfigured'
    this.#reason = undefined
    clearTimeout(this.#fallbackTimer)
    this.#owner = 'agent'
    this.#controller = undefined
  }

  status(): DesktopStatus {
    const status: DesktopStatus = { state: this.#state, owner: this.#owner, recording: false }
    if (this.#reason !== undefined) {
      status.reason = this.#reason
    }
    if (this.#state === 'ready' && this.#control) {
      status.width = this.#control.framebuffer.width
      status.height = this.#control.framebuffer.height
    }
    return status
  }

  /** For the in-environment launcher (Task 5); never put the token in output. */
  launcherEndpoint(): { host: string; port: number; token: string } | undefined {
    return this.#target && this.#launcher
      ? { host: this.#target.host, ...this.#launcher }
      : undefined
  }

  setOwner(owner: DesktopOwner, viewerId?: string): void {
    if (owner === 'user' && !viewerId) {
      throw new DesktopError('desktop_invalid_input', 'viewerId is required to take control')
    }
    const controller = owner === 'user' ? viewerId : undefined
    if (owner === this.#owner && controller === this.#controller) {
      return
    }
    this.#releaseHeldInput()
    this.#owner = owner
    this.#controller = controller
    clearTimeout(this.#fallbackTimer)
    if (controller !== undefined && !this.#viewers.has(controller)) {
      this.#startOwnerFallback()
    }
  }

  async openViewer(viewerId: string, downstream: Duplex): Promise<void> {
    const target = this.#target
    if (!target) {
      downstream.destroy()
      throw new DesktopError('desktop_unavailable', 'desktop_unconfigured')
    }
    this.#viewers.get(viewerId)?.close()
    if (this.#controller === viewerId) {
      clearTimeout(this.#fallbackTimer)
    }
    const generation = this.#generation
    let session: DesktopViewerSession | undefined
    try {
      session = await DesktopViewerSession.open(target, downstream, {
        inputAllowed: () =>
          this.#owner === 'user' &&
          this.#controller === viewerId &&
          this.#viewers.get(viewerId) === session,
        onClosed: () => this.#onViewerClosed(viewerId, session)
      })
    } catch (error) {
      this.#onViewerClosed(viewerId, undefined)
      throw new DesktopError('desktop_unavailable', desktopFailureReason(error))
    }
    if (generation !== this.#generation) {
      session.close()
      throw new DesktopError('desktop_unavailable', 'desktop_reconfigured')
    }
    this.#viewers.set(viewerId, session)
  }

  closeViewer(viewerId: string): void {
    this.#viewers.get(viewerId)?.close()
  }

  async move(x: number, y: number): Promise<void> {
    agentMove(this.#agentInput, { x, y })
  }

  click(x: number, y: number, opts: { button: DesktopButton; double?: boolean }): Promise<void> {
    return agentClick(this.#agentInput, { x, y }, opts)
  }

  drag(from: DesktopPoint, to: DesktopPoint): Promise<void> {
    return agentDrag(this.#agentInput, from, to)
  }

  scroll(x: number, y: number, opts: { dy: number }): Promise<void> {
    return agentScroll(this.#agentInput, { x, y }, opts)
  }

  type(text: string): Promise<void> {
    return agentType(this.#agentInput, text)
  }

  async key(combo: string): Promise<void> {
    agentKey(this.#agentInput, combo)
  }

  /** Allowed whoever owns the desktop. */
  async screenshot(): Promise<{ png: Buffer; width: number; height: number }> {
    const control = this.#control
    if (this.#state !== 'ready' || !control) {
      throw new DesktopError('desktop_unavailable', this.#reason)
    }
    const { width, height } = control.framebuffer
    return { png: await encodePng(width, height, control.framebuffer.rgba()), width, height }
  }

  /** Called after every FramebufferUpdate on the control connection. */
  onFrame(cb: (fb: RfbFramebuffer) => void): () => void {
    this.#frameListeners.add(cb)
    return () => this.#frameListeners.delete(cb)
  }

  // Ownership is checked here, per input event, so a long action stops as soon as control moves.
  #readyControl(): DesktopControlConnection {
    if (this.#owner === 'user') {
      throw new DesktopError('desktop_user_in_control')
    }
    const control = this.#control
    if (this.#state !== 'ready' || !control?.writable) {
      throw new DesktopError('desktop_unavailable', this.#reason)
    }
    return control
  }

  #releaseHeldInput(): void {
    if (this.#owner === 'agent') {
      const control = this.#control
      if (control?.writable) {
        control.writeRelease(control.held.releaseMessages())
      }
    } else if (this.#controller !== undefined) {
      this.#viewers.get(this.#controller)?.releaseHeld()
    }
  }

  #startOwnerFallback(): void {
    clearTimeout(this.#fallbackTimer)
    this.#fallbackTimer = setTimeout(() => {
      if (this.#controller !== undefined && !this.#viewers.has(this.#controller)) {
        this.setOwner('agent')
      }
    }, OWNER_FALLBACK_MS)
  }

  #onViewerClosed(viewerId: string, session: DesktopViewerSession | undefined): void {
    if (session !== undefined) {
      if (this.#viewers.get(viewerId) !== session) {
        return
      }
      this.#viewers.delete(viewerId)
    }
    if (this.#owner === 'user' && this.#controller === viewerId && !this.#viewers.has(viewerId)) {
      this.#startOwnerFallback()
    }
  }

  #disconnect(): void {
    this.#generation++
    clearTimeout(this.#retryTimer)
    this.#control?.close()
    this.#control = undefined
    for (const session of this.#viewers.values()) {
      session.close()
    }
  }

  async #connect(generation: number): Promise<void> {
    const target = this.#target
    if (!target) {
      return
    }
    let control: DesktopControlConnection | undefined
    try {
      control = await DesktopControlConnection.open(target, {
        onFrame: (fb) => {
          for (const listener of this.#frameListeners) {
            listener(fb)
          }
        },
        onLost: (reason) => {
          if (this.#control === control) {
            this.#control = undefined
            this.#fail(generation, reason)
          }
        }
      })
    } catch (error) {
      if (generation === this.#generation) {
        this.#fail(generation, desktopFailureReason(error))
      }
      return
    }
    if (generation !== this.#generation) {
      control.close()
      return
    }
    this.#control = control
    this.#state = 'ready'
    this.#reason = undefined
    this.#retryDelayMs = RETRY_INITIAL_MS
  }

  // A wrong password is not retried: it will not fix itself and VNC servers blacklist repeats.
  #fail(generation: number, reason: string): void {
    this.#state = 'unavailable'
    this.#reason = reason
    if (reason === 'rfb_auth_failed') {
      return
    }
    const delay = this.#retryDelayMs
    this.#retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS)
    clearTimeout(this.#retryTimer)
    this.#retryTimer = setTimeout(() => {
      if (generation === this.#generation) {
        void this.#connect(generation)
      }
    }, delay)
  }
}

let broker: DesktopBroker | undefined

/** The process-wide broker of this environment's Orca server. */
export function getDesktopBroker(): DesktopBroker {
  broker ??= new DesktopBroker()
  return broker
}
