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
// One read per host connection a minute, however many chat rows ask.
let cache = new WeakMap<RpcClient, { at: number; enabled: Promise<boolean> }>()

export function resetMobileEphemeralVmsSettingCache(): void {
  cache = new WeakMap()
}

/** The desktop's `experimentalEphemeralVms` setting, read from the paired Mac; false when unknown. */
export function readMobileEphemeralVmsEnabled(client: RpcClient): Promise<boolean> {
  const cached = cache.get(client)
  if (cached && Date.now() - cached.at < REFRESH_MS) {
    return cached.enabled
  }
  const enabled = ephemeralVmsRead
    .request(client)
    .then((reply) => {
      const read = ephemeralVmsRead.interpret(reply)
      return read.accepted && read.value
    })
    .catch(() => false)
  cache.set(client, { at: Date.now(), enabled })
  return enabled
}

export function useMobileEphemeralVmsEnabled(client: RpcClient | undefined): boolean {
  const [state, setState] = useState<{ client: RpcClient; enabled: boolean } | null>(null)
  useEffect(() => {
    if (!client) {
      return
    }
    let current = true
    void readMobileEphemeralVmsEnabled(client).then((enabled) => {
      if (current) {
        setState({ client, enabled })
      }
    })
    return () => {
      current = false
    }
  }, [client])
  return state !== null && state.client === client && state.enabled
}
