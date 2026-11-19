import { useCallback, useSyncExternalStore } from 'react'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../../transport/rpc/rpc-operation'
import type { RpcCompatibleReader } from '../../../transport/rpc/rpc-operation-contract'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import { subscribeSharedClientEvents } from '../../../transport/connection/shared-client-events'
import { settingsField, settingsMember } from '../../../settings/mobile-settings-projection'

// Older hosts omit the setting; only an explicit true turns the experiment on.
const ephemeralVmsReader: RpcCompatibleReader<unknown, 'ephemeral-vms-setting', boolean> = (
  raw
) => {
  const settings = raw == null ? undefined : settingsMember(raw)
  return {
    compatible: true,
    variant: 'ephemeral-vms-setting',
    value: settings != null && settingsField(settings, 'experimentalEphemeralVms') === true,
    salvage: { droppedPaths: [], droppedCount: 0 }
  }
}

const ephemeralVmsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'settings.ephemeral-vms-or-skip',
    method: 'settings.get',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: ephemeralVmsReader
  })
)

// A mount while other rows are mounted re-reads a value older than this; mounted rows hear changes live.
const MAX_AGE_MS = 60_000
const SETTING_KEY = 'experimentalEphemeralVms'

type SettingStore = {
  /** Last value the host gave; null until a read succeeds. Rows show it while a revalidation is pending. */
  value: boolean | null
  /** When the read behind `value` went out. */
  readAt: number
  /** The current read, shared by every mount. */
  inFlight: Promise<void> | null
  /** Bumped by every read, so only the newest read's answer lands. */
  generation: number
  subscriberCount: number
  unsubscribe: (() => void) | null
  listeners: Set<() => void>
}

let stores = new WeakMap<RpcClient, SettingStore>()

export function resetMobileEphemeralVmsSettingCache(): void {
  stores = new WeakMap()
}

function storeFor(client: RpcClient): SettingStore {
  let store = stores.get(client)
  if (!store) {
    store = {
      value: null,
      readAt: -Infinity,
      inFlight: null,
      generation: 0,
      subscriberCount: 0,
      unsubscribe: null,
      listeners: new Set()
    }
    stores.set(client, store)
  }
  return store
}

/** Replaces any read in flight; a failed read keeps the last good value. */
function revalidate(client: RpcClient, store: SettingStore): void {
  const generation = ++store.generation
  const readAt = Date.now()
  const settle = (value: boolean | null): void => {
    if (generation !== store.generation) {
      return
    }
    store.inFlight = null
    if (value !== null) {
      store.value = value
      store.readAt = readAt
      for (const listener of store.listeners) {
        listener()
      }
    }
  }
  store.inFlight = ephemeralVmsRead.request(client).then(
    (reply) => {
      const result = ephemeralVmsRead.interpret(reply)
      settle(result.accepted && result.value)
    },
    () => settle(null)
  )
}

function listen(client: RpcClient, store: SettingStore): () => void {
  return subscribeSharedClientEvents(client, (event) => {
    const changed =
      event.type === 'settingsChanged' &&
      (!Array.isArray(event.keys) || event.keys.includes(SETTING_KEY))
    // A first or replayed ready may follow missed events; a joined ready is covered by the mount's read.
    const opened = event.type === 'ready' && !('joined' in event)
    if (changed || opened) {
      revalidate(client, store)
    }
  })
}

function subscribe(client: RpcClient, store: SettingStore, listener: () => void): () => void {
  store.listeners.add(listener)
  store.subscriberCount += 1
  if (store.subscriberCount === 1) {
    // Nothing heard the host while no row was mounted, so the cached value may be stale.
    store.unsubscribe = listen(client, store)
    revalidate(client, store)
  } else if (!store.inFlight && Date.now() - store.readAt >= MAX_AGE_MS) {
    revalidate(client, store)
  }
  return () => {
    store.listeners.delete(listener)
    store.subscriberCount -= 1
    if (store.subscriberCount === 0) {
      store.unsubscribe?.()
      store.unsubscribe = null
    }
  }
}

/** The desktop's `experimentalEphemeralVms` setting, read from the paired Mac; false until known. */
export function useMobileEphemeralVmsEnabled(client: RpcClient | undefined): boolean {
  const subscribeToClient = useCallback(
    (listener: () => void) => (client ? subscribe(client, storeFor(client), listener) : () => {}),
    [client]
  )
  const enabled = (): boolean => (client ? storeFor(client).value === true : false)
  return useSyncExternalStore(subscribeToClient, enabled, enabled)
}
