import { subscribeRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'

const RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 60_000]

/**
 * Keeps one `desktop.events` stream open to the environment until `signal` aborts: a stream that
 * closes, fails or is refused reopens after a backoff, which a `ready` event resets.
 */
export function keepDesktopEventsStream(
  runtimeEnvironmentId: string,
  onEvent: (event: Record<string, unknown>) => void,
  signal: AbortSignal
): void {
  let subscription: { close: () => void } | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0

  const scheduleReconnect = (): void => {
    subscription = null
    if (signal.aborted || reconnectTimer) {
      return
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function connect(): void {
    let ended = false
    const end = (): void => {
      if (!ended) {
        ended = true
        scheduleReconnect()
      }
    }
    subscribeRuntimeEnvironment(
      getRuntimeEnvironmentRegistryRoot(),
      runtimeEnvironmentId,
      'desktop.events',
      {},
      undefined,
      {
        onEvent: (payload) => {
          if (ended) {
            return
          }
          if (payload.type === 'response' && payload.response.ok) {
            const event = payload.response.result
            if (typeof event === 'object' && event !== null) {
              if ('type' in event && event.type === 'ready') {
                reconnectAttempt = 0
              }
              onEvent({ ...event })
            }
          } else if (payload.type === 'response' || payload.type === 'error') {
            // A refusal (another controller, no desktop yet) or a midstream failure ends this stream.
            subscription?.close()
            end()
          }
        },
        onClose: end
      },
      () => !signal.aborted && !ended,
      signal
    ).then(
      (opened) => {
        if (signal.aborted || ended) {
          opened.close()
          return
        }
        subscription = opened
      },
      () => end()
    )
  }

  signal.addEventListener(
    'abort',
    () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      subscription?.close()
      subscription = null
    },
    { once: true }
  )
  connect()
}
