import { useEffect, useState } from 'react'
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

// A value older than this is re-read by the next row that mounts; mounted rows hear changes live.
const MAX_AGE_MS = 60_000
const SETTING_KEY = 'experimentalEphemeralVms'

type ClientEntry = {
  enabled: boolean | null
  /** When the read behind `enabled` went out; settingsChanged resets it to "never". */
  readAt: number
  /** Bumped by every read and invalidation, so an older read cannot land over a newer answer. */
  version: number
  listeners: Set<() => void>
  stopEvents: (() => void) | null
}

let entries = new WeakMap<RpcClient, ClientEntry>()

export function resetMobileEphemeralVmsSettingCache(): void {
  entries = new WeakMap()
}

function entryFor(client: RpcClient): ClientEntry {
  let entry = entries.get(client)
  if (!entry) {
    entry = { enabled: null, readAt: -Infinity, version: 0, listeners: new Set(), stopEvents: null }
    entries.set(client, entry)
  }
  return entry
}

function read(client: RpcClient, entry: ClientEntry): void {
  const version = ++entry.version
  const readAt = Date.now()
  void ephemeralVmsRead
    .request(client)
    .then((reply) => {
      const result = ephemeralVmsRead.interpret(reply)
      return result.accepted && result.value
    })
    .catch(() => false)
    .then((enabled) => {
      if (version !== entry.version) {
        return
      }
      entry.enabled = enabled
      entry.readAt = readAt
      for (const listener of entry.listeners) {
        listener()
      }
    })
}

function isFresh(entry: ClientEntry): boolean {
  return entry.enabled !== null && Date.now() - entry.readAt < MAX_AGE_MS
}

/** Mounted rows follow the host's settingsChanged events on the shared client-events stream. */
function listen(client: RpcClient, entry: ClientEntry): void {
  entry.stopEvents = subscribeSharedClientEvents(client, (event) => {
    const changed =
      event.type === 'settingsChanged' &&
      (!Array.isArray(event.keys) || event.keys.includes(SETTING_KEY))
    // A replayed ready means events were missed while the stream was down.
    const missed = event.type === 'ready' && 'replayed' in event && event.replayed === true
    if (changed || missed) {
      entry.readAt = -Infinity
      read(client, entry)
    }
  })
}

/** The desktop's `experimentalEphemeralVms` setting, read from the paired Mac; false until known. */
export function useMobileEphemeralVmsEnabled(client: RpcClient | undefined): boolean {
  const [state, setState] = useState<{ client: RpcClient; enabled: boolean } | null>(null)
  useEffect(() => {
    if (!client) {
      return
    }
    const entry = entryFor(client)
    const update = (): void => {
      if (entry.enabled !== null) {
        setState({ client, enabled: entry.enabled })
      }
    }
    entry.listeners.add(update)
    if (!entry.stopEvents) {
      listen(client, entry)
    }
    if (isFresh(entry)) {
      update()
    } else {
      read(client, entry)
    }
    return () => {
      entry.listeners.delete(update)
      if (entry.listeners.size === 0) {
        entry.stopEvents?.()
        entry.stopEvents = null
      }
    }
  }, [client])
  return state !== null && state.client === client && state.enabled
}
