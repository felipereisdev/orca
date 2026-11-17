import { defineFixture } from '../../component-fixtures/component-fixture'
import type { DatabaseConnectionSummary } from '../../../../shared/database/database-contracts'
import { DatabaseConnectionPickerDialog } from './DatabaseConnectionPickerDialog'

const noop = (): void => {}
const connection = (id: string, alias: string, environment: string): DatabaseConnectionSummary => ({
  id,
  revision: 1,
  alias,
  displayName: alias,
  engine: 'postgres',
  environment,
  executionHostId: 'local',
  projects: [],
  limits: { timeoutMs: 30000, maxRows: 1000, maxOutputBytes: 5242880 }
})

export const several = defineFixture({
  width: 520,
  render: () => (
    <DatabaseConnectionPickerDialog
      open
      onOpenChange={noop}
      onSelect={noop}
      connections={{
        status: 'ready',
        controllerRuntimeId: 'fixture-controller',
        entries: [
          connection('11111111-1111-4111-8111-111111111111', 'faturacao-hmg', 'HMG'),
          connection('22222222-2222-4222-8222-222222222222', 'faturacao-prd', 'PRD'),
          connection('33333333-3333-4333-8333-333333333333', 'crm-dev', 'DEV')
        ]
      }}
    />
  )
})

export const empty = defineFixture({
  width: 520,
  render: () => (
    <DatabaseConnectionPickerDialog
      open
      onOpenChange={noop}
      onSelect={noop}
      connections={{ status: 'ready', controllerRuntimeId: 'fixture-controller', entries: [] }}
    />
  )
})
