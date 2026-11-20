import { defineFixture } from '../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'
import { EphemeralVmRunningIndicator } from './EphemeralVmRunningIndicator'

function storeFor(uiLanguage: 'en' | 'pt', runningEphemeralVmRuntimeCount: number) {
  return {
    settings: {
      ...getDefaultSettings('/tmp/orca-fixture'),
      uiLanguage,
      experimentalEphemeralVms: true
    },
    runningEphemeralVmRuntimeCount
  }
}

function Bar({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <div className="flex h-6 items-center border-t border-border bg-sidebar px-2 text-foreground">
      <EphemeralVmRunningIndicator iconOnly={iconOnly} />
    </div>
  )
}

export const twoRunning = defineFixture({
  width: 260,
  store: storeFor('en', 2),
  render: () => <Bar />
})

export const oneRunningPt = defineFixture({
  width: 260,
  store: storeFor('pt', 1),
  render: () => <Bar />
})

export const twoRunningPt = defineFixture({
  width: 260,
  store: storeFor('pt', 2),
  render: () => <Bar />
})

export const threeRunningCompact = defineFixture({
  width: 120,
  store: storeFor('pt', 3),
  render: () => <Bar iconOnly />
})
