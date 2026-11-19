import { defineFixture } from '../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'
import type { EphemeralVmWorkspaceRuntime } from '@/store/slices/ephemeral-vm/ephemeral-vm-lifecycle'
import { EphemeralVmRunningIndicator } from './EphemeralVmRunningIndicator'

function runtimesIn(
  statuses: EphemeralVmWorkspaceRuntime['status'][]
): Record<string, EphemeralVmWorkspaceRuntime> {
  return Object.fromEntries(
    statuses.map((status, index) => [
      `ws-${index}`,
      { id: `vm-${index}`, workspaceId: `ws-${index}`, status, canSuspend: true }
    ])
  )
}

function storeFor(uiLanguage: 'en' | 'pt', statuses: EphemeralVmWorkspaceRuntime['status'][]) {
  return {
    settings: {
      ...getDefaultSettings('/tmp/orca-fixture'),
      uiLanguage,
      experimentalEphemeralVms: true
    },
    ephemeralVmRuntimesByWorkspaceId: runtimesIn(statuses)
  }
}

function Bar() {
  return (
    <div className="flex h-6 items-center border-t border-border bg-sidebar px-2 text-foreground">
      <EphemeralVmRunningIndicator iconOnly={false} />
    </div>
  )
}

export const twoRunning = defineFixture({
  width: 260,
  store: storeFor('en', ['running', 'suspend_failed', 'suspended']),
  render: () => <Bar />
})

export const oneRunningPt = defineFixture({
  width: 260,
  store: storeFor('pt', ['running', 'suspended']),
  render: () => <Bar />
})

export const twoRunningPt = defineFixture({
  width: 260,
  store: storeFor('pt', ['running', 'running']),
  render: () => <Bar />
})
