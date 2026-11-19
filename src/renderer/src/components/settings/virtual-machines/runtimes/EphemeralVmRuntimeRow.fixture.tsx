import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import type { EphemeralVmRuntimeRecord } from '../../../../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type { EphemeralVmRecipeStats } from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { EphemeralVmRuntimeRow } from './EphemeralVmRuntimeRow'

function runtime(id: string, workspaceName: string): EphemeralVmRuntimeRecord {
  return {
    id,
    recipeId: 'docker-desktop',
    workspaceName,
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: 1,
    updatedAt: 1,
    recipeResult: {
      schemaVersion: 1,
      connection: {
        type: 'ssh',
        target: { label: 'env', host: '127.0.0.1', port: 2222, username: 'dev' },
        projectRoot: '/workspace/acme'
      }
    }
  }
}

function Row({ name, stats }: { name: string; stats: EphemeralVmRecipeStats | null }) {
  return (
    <EphemeralVmRuntimeRow
      runtime={runtime(`vm-${name}`, name)}
      statusLabel="Running"
      stats={stats}
      cleanupFailed={false}
      cleanupRunning={false}
      isStopping={false}
      disabled={false}
      onCleanup={() => {}}
      onStopCleanup={() => {}}
      onCopyCleanupCommand={() => {}}
      onForget={() => {}}
    />
  )
}

function Rows() {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card text-foreground">
      <Row
        name="login-flow"
        stats={{ cpuPercent: 12.5, memoryBytes: 1_536_000_000, diskBytes: 342_000_000 }}
      />
      <Row name="checkout-bug" stats={null} />
    </div>
  )
}

const storeFor = (uiLanguage: 'en' | 'pt') => ({
  settings: { ...getDefaultSettings('/tmp/orca-fixture'), uiLanguage }
})

export const statsRows = defineFixture({
  width: 720,
  store: storeFor('en'),
  render: () => <Rows />
})

export const statsRowsPt = defineFixture({
  width: 720,
  store: storeFor('pt'),
  render: () => <Rows />
})
