import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { RuntimeRpcResponse } from '../../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import { subscribeRuntimeEnvironment } from '@/runtime/rpc/environment-revisions/runtime-environment-pairing-refresh'
import { getRuntimeEnvironmentRevision } from '@/runtime/rpc/environment-revisions/runtime-environment-revision'

export type DesktopViewerSubscribe = typeof subscribeRuntimeEnvironment

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

/** The parts of a WebSocket that noVNC's `RFB` reads from a channel passed in place of a URL. */
export type WebSocketLike = {
  binaryType: string
  readonly protocol: string
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null
  onerror: ((event: unknown) => void) | null
  send: (data: ArrayBuffer | ArrayBufferView) => void
  close: () => void
}

function toArrayBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBufferLike> {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data.slice(0))
    : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

function resultType(response: RuntimeRpcResponse<unknown>): unknown {
  const result = response.ok ? response.result : undefined
  return result && typeof result === 'object' && 'type' in result ? result.type : undefined
}

/**
 * `desktop.viewer` as a WebSocket for noVNC. Each subscription has its own connection to the
 * environment, so its raw binary handler never meets the workspace's terminal streams.
 */
class DesktopViewerChannel implements WebSocketLike {
  binaryType = 'arraybuffer'
  onopen: WebSocketLike['onopen'] = null
  onmessage: WebSocketLike['onmessage'] = null
  onclose: WebSocketLike['onclose'] = null
  onerror: WebSocketLike['onerror'] = null
  #state = CONNECTING
  #ready = false
  #pending: ArrayBuffer[] = []
  #handle: Awaited<ReturnType<DesktopViewerSubscribe>> | null = null

  constructor(target: RuntimeClientTarget, viewerId: string, subscribe: DesktopViewerSubscribe) {
    if (target.kind !== 'environment') {
      queueMicrotask(() => this.#fail())
      return
    }
    subscribe(
      {
        selector: target.environmentId,
        method: 'desktop.viewer',
        params: { viewerId },
        timeoutMs: 15_000,
        expectedEnvironmentPairingRevision: getRuntimeEnvironmentRevision(target.environmentId)
      },
      {
        onResponse: (response) => this.#onResponse(response),
        onBinary: (bytes) => this.#onBinary(bytes),
        onError: () => this.#fail(),
        onClose: () => this.#finish(false)
      }
    ).then(
      (handle) => {
        this.#handle = handle
        if (this.#state === CLOSED) {
          handle.unsubscribe()
          return
        }
        this.#openIfReady()
      },
      () => this.#fail()
    )
  }

  get protocol(): string {
    return ''
  }

  get readyState(): number {
    return this.#state
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.#state === OPEN) {
      this.#handle?.sendBinary(toBytes(data))
    }
  }

  close(): void {
    this.#finish(true)
  }

  #onResponse(response: RuntimeRpcResponse<unknown>): void {
    if (!response.ok) {
      this.#fail()
      return
    }
    const type = resultType(response)
    if (type === 'ready') {
      this.#ready = true
      this.#openIfReady()
    } else if (type === 'end') {
      this.#finish(true)
    }
  }

  #onBinary(bytes: Uint8Array<ArrayBufferLike>): void {
    if (this.#state === CLOSED) {
      return
    }
    // RFB bytes may come before the subscribe reply; noVNC must see them in order after open.
    if (this.#state === CONNECTING) {
      this.#pending.push(toArrayBuffer(bytes))
      return
    }
    this.onmessage?.({ data: toArrayBuffer(bytes) })
  }

  #openIfReady(): void {
    if (this.#state !== CONNECTING || !this.#ready || !this.#handle) {
      return
    }
    this.#state = OPEN
    this.onopen?.(new Event('open'))
    const pending = this.#pending
    this.#pending = []
    for (const data of pending) {
      if (this.#state !== OPEN) {
        return
      }
      this.onmessage?.({ data })
    }
  }

  #fail(): void {
    if (this.#state === CLOSED) {
      return
    }
    this.onerror?.(new Event('error'))
    this.#finish(true)
  }

  #finish(unsubscribe: boolean): void {
    if (this.#state === CLOSED) {
      return
    }
    const wasClean = this.#state === OPEN
    this.#state = CLOSED
    this.#pending = []
    if (unsubscribe) {
      this.#handle?.unsubscribe()
    }
    this.onclose?.({ code: wasClean ? 1000 : 1006, reason: '', wasClean })
  }
}

export function createDesktopViewerChannel(
  target: RuntimeClientTarget,
  viewerId: string,
  subscribe: DesktopViewerSubscribe = subscribeRuntimeEnvironment
): WebSocketLike {
  return new DesktopViewerChannel(target, viewerId, subscribe)
}
