import { useEffect, useState } from 'react'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../../transport/rpc/rpc-operation'
import type { RpcCompatibleReader } from '../../../transport/rpc/rpc-operation-contract'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
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

const REFRESH_MS = 60_000

type ClientEntry = {
  enabled: boolean | null
  reading: Promise<boolean> | null
  listeners: Set<() => void>
  timer: ReturnType<typeof setTimeout> | null
}

// One read per host connection a minute, however many chat rows show it; rows still mounted when
// the minute ends get the new value, so an open transcript follows a changed setting.
let entries = new WeakMap<RpcClient, ClientEntry>()

export function resetMobileEphemeralVmsSettingCache(): void {
  entries = new WeakMap()
}

function entryFor(client: RpcClient): ClientEntry {
  let entry = entries.get(client)
  if (!entry) {
    entry = { enabled: null, reading: null, listeners: new Set(), timer: null }
    entries.set(client, entry)
  }
  return entry
}

function read(client: RpcClient, entry: ClientEntry): Promise<boolean> {
  entry.reading ??= ephemeralVmsRead
    .request(client)
    .then((reply) => {
      const result = ephemeralVmsRead.interpret(reply)
      return result.accepted && result.value
    })
    .catch(() => false)
    .then((enabled) => {
      entry.reading = null
      entry.enabled = enabled
      for (const listener of entry.listeners) {
        listener()
      }
      scheduleRefresh(client, entry)
      return enabled
    })
  return entry.reading
}

function scheduleRefresh(client: RpcClient, entry: ClientEntry): void {
  if (entry.timer || entry.listeners.size === 0) {
    return
  }
  entry.timer = setTimeout(() => {
    entry.timer = null
    if (entry.listeners.size > 0) {
      void read(client, entry)
    } else {
      // Nobody shows it now: the next row to mount reads afresh.
      entry.enabled = null
    }
  }, REFRESH_MS)
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
    if (entry.enabled === null) {
      void read(client, entry)
    } else {
      update()
      scheduleRefresh(client, entry)
    }
    return () => {
      entry.listeners.delete(update)
    }
  }, [client])
  return state !== null && state.client === client && state.enabled
}
