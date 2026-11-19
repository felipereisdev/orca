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
import { DesktopControlConnection, type DesktopFrame } from './desktop-control-connection'
import { DesktopError } from './desktop-errors'
import { DesktopRecorder, type DesktopRecorderDeps } from './desktop-recorder'
import {
  assertValidConfig,
  isSameDesktopBrokerConfig,
  verifyDesktopCredentials,
  type DesktopBrokerConfig
} from './desktop-broker-config'
import { desktopFailureReason, type DesktopVncTarget } from './desktop-upstream'
import { DesktopViewerRegistry } from './desktop-viewer-registry'
import { encodePng } from './rfb/png-encode'

import type { DesktopOwner, DesktopStatus } from './desktop-broker-status'

export type { DesktopOwner, DesktopStatus } from './desktop-broker-status'
export type { DesktopBrokerConfig } from './desktop-broker-config'

const OWNER_FALLBACK_MS = 5_000
const RETRY_INITIAL_MS = 1_000
const RETRY_MAX_MS = 30_000

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
  /** Bumped on every owner or controller change; agent commands are bound to one value. */
  #ownerEpoch = 0
  #fallbackTimer: ReturnType<typeof setTimeout> | undefined
  /** The control connection attempt in flight; a reconfigure aborts it. */
  #connectAttempt: AbortController | undefined
  readonly #viewers = new DesktopViewerRegistry({
    inControl: (viewerId) => this.#owner === 'user' && this.#controller === viewerId,
    bounds: () => this.#control?.desktopSize,
    onRegistered: (viewerId) => {
      if (this.#controller === viewerId) {
        clearTimeout(this.#fallbackTimer)
      }
    },
    onClosed: (viewerId) => {
      if (this.#owner === 'user' && this.#controller === viewerId) {
        this.#startOwnerFallback()
      }
    }
  })
  readonly #frameListeners = new Set<(frame: DesktopFrame) => void>()
  readonly recorder: DesktopRecorder

  constructor({ recorder }: { recorder?: DesktopRecorderDeps } = {}) {
    this.recorder = new DesktopRecorder(this, recorder)
  }

  /**
   * Replaces any previous configuration and reconnects; resolves after the first attempt. The same
   * configuration again (a host re-attaching or resuming) changes nothing, so viewers stay open.
   */
  async configure(cfg: DesktopBrokerConfig): Promise<void> {
    const host = assertValidConfig(cfg)
    const current = this.#target && { ...this.#target, launcher: this.#launcher }
    if (this.#state !== 'unconfigured' && isSameDesktopBrokerConfig(current, { ...cfg, host })) {
      return
    }
    this.#disconnect()
    this.#target = { host, port: cfg.port, password: cfg.password }
    this.#launcher = cfg.launcher ? { ...cfg.launcher } : undefined
    this.#state = 'connecting'
    this.#reason = undefined
    this.#retryDelayMs = RETRY_INITIAL_MS
    await this.#connect(this.#generation)
  }

  /** Proves `cfg` against the VNC server without touching this broker. */
  verifyCredentials(cfg: DesktopBrokerConfig): Promise<void> {
    return verifyDesktopCredentials(cfg)
  }

  /** Drops the configuration, every connection and timer; a recording is finalized, a pending one cancelled. */
  close(): void {
    this.recorder.close()
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
    const status: DesktopStatus = {
      state: this.#state,
      ...(this.#reason !== undefined ? { reason: this.#reason } : {}),
      owner: this.#owner,
      recording: this.recorder.active()
    }
    if (this.#state === 'ready' && this.#control) {
      status.width = this.#control.frame.width
      status.height = this.#control.frame.height
    }
    return status
  }

  /** For the in-environment launcher (Task 5); never put the token in output. */
  launcherEndpoint(): { host: string; port: number; token: string } | undefined {
    return this.#target && this.#launcher
      ? { host: this.#target.host, ...this.#launcher }
      : undefined
  }

  /** `viewerId`'s view of control: it (`this`) or another viewer (`other`) holds it, or nobody. */
  viewerControl(viewerId: string): 'this' | 'other' | null {
    return this.#owner !== 'user' ? null : this.#controller === viewerId ? 'this' : 'other'
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
    this.#ownerEpoch++
    clearTimeout(this.#fallbackTimer)
    if (controller !== undefined && !this.#viewers.has(controller)) {
      this.#startOwnerFallback()
    }
  }

  /** A pending open for the same id is cancelled; control's fallback deadline is not reset. */
  async openViewer(viewerId: string, downstream: Duplex): Promise<void> {
    const target = this.#target
    if (!target) {
      downstream.destroy()
      throw new DesktopError('desktop_unavailable', 'desktop_unconfigured')
    }
    const generation = this.#generation
    await this.#viewers.open(target, viewerId, downstream, () => generation === this.#generation)
  }

  closeViewer(viewerId: string): void {
    this.#viewers.close(viewerId)
  }

  move(x: number, y: number): Promise<void> {
    return this.#agentCommand(async (sink) => agentMove(sink, { x, y }))
  }

  click(x: number, y: number, opts: { button: DesktopButton; double?: boolean }): Promise<void> {
    return this.#agentCommand((sink) => agentClick(sink, { x, y }, opts))
  }

  drag(from: DesktopPoint, to: DesktopPoint): Promise<void> {
    return this.#agentCommand((sink) => agentDrag(sink, from, to))
  }

  scroll(x: number, y: number, opts: { dy: number }): Promise<void> {
    return this.#agentCommand((sink) => agentScroll(sink, { x, y }, opts))
  }

  type(text: string): Promise<void> {
    return this.#agentCommand((sink) => agentType(sink, text))
  }

  key(combo: string): Promise<void> {
    return this.#agentCommand(async (sink) => agentKey(sink, combo))
  }

  /** Allowed whoever owns the desktop. */
  async screenshot(): Promise<{ png: Buffer; width: number; height: number }> {
    const control = this.#control
    if (this.#state !== 'ready' || !control) {
      throw new DesktopError('desktop_unavailable', this.#reason)
    }
    const frame = control.frame
    const { width, height } = frame
    return { png: await encodePng(width, height, frame.rgba()), width, height }
  }

  /** The latest complete frame while the desktop is ready. */
  currentFrame(): DesktopFrame | undefined {
    return this.#state === 'ready' ? this.#control?.frame : undefined
  }

  /** Called with each complete frame (a snapshot) from the control connection. */
  onFrame(cb: (frame: DesktopFrame) => void): () => void {
    this.#frameListeners.add(cb)
    return () => this.#frameListeners.delete(cb)
  }

  /**
   * Checks ownership and readiness at entry, then queues the command on the connection it started
   * on. Every input event re-checks that neither the connection nor the owner changed since.
   */
  #agentCommand(run: (sink: AgentInputSink) => Promise<void>): Promise<void> {
    const control = this.#control
    const epoch = this.#ownerEpoch
    try {
      this.#assertAgentCanAct(control, epoch)
    } catch (error) {
      return Promise.reject(error)
    }
    const bound = (): DesktopControlConnection => this.#assertAgentCanAct(control, epoch)
    return bound().enqueue(() => {
      bound()
      return run({ send: (message) => bound().write(message), size: () => bound().desktopSize })
    })
  }

  #assertAgentCanAct(
    control: DesktopControlConnection | undefined,
    epoch: number
  ): DesktopControlConnection {
    if (this.#owner === 'user' || epoch !== this.#ownerEpoch) {
      throw new DesktopError('desktop_user_in_control')
    }
    if (!control || control !== this.#control || this.#state !== 'ready' || !control.writable) {
      const reason = this.#target
        ? (this.#reason ?? 'desktop_reconfigured')
        : 'desktop_unconfigured'
      throw new DesktopError('desktop_unavailable', reason)
    }
    return control
  }

  #releaseHeldInput(): void {
    if (this.#owner === 'agent') {
      const control = this.#control
      if (control?.writable) {
        control.releaseHeld()
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

  #disconnect(): void {
    this.#generation++
    this.#connectAttempt?.abort()
    this.#connectAttempt = undefined
    clearTimeout(this.#retryTimer)
    // Viewers release held input on close, inside the size the control connection knows.
    this.#viewers.closeAll()
    // Best effort: the agent's held input is released before the old socket is torn down.
    this.#control?.releaseHeldBestEffort()
    this.#control?.close()
    this.#control = undefined
  }

  async #connect(generation: number): Promise<void> {
    const target = this.#target
    if (!target) {
      return
    }
    let control: DesktopControlConnection | undefined
    const attempt = new AbortController()
    this.#connectAttempt = attempt
    try {
      control = await DesktopControlConnection.open(
        target,
        {
          onFrame: (frame) => {
            // A listener may reconfigure; later listeners must not see the superseded frame.
            for (const listener of this.#frameListeners) {
              if (generation !== this.#generation) {
                return
              }
              listener(frame)
            }
          },
          onDesktopSize: (size) => {
            if (generation === this.#generation) {
              this.#viewers.announceBounds(size)
            }
          },
          onLost: (reason) => {
            if (this.#control === control) {
              this.#control = undefined
              this.#fail(generation, reason)
            }
          }
        },
        attempt.signal
      )
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
