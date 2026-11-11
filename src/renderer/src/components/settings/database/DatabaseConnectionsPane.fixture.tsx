import { useMemo } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { ConfirmationDialogProvider } from '../../confirmation-dialog'
import { DatabaseConnectionsPane } from './DatabaseConnectionsPane'
import { createDatabaseClientFixture } from './testing/database-client-fixture'
import type { DatabaseConnectionSummary } from '../../../../../shared/database/database-contracts'

type State = 'catalog' | 'empty' | 'error' | 'host-unavailable'
function Preview({ state = 'catalog' }: { state?: State }) {
  const client = useMemo(() => {
    const fixture = createDatabaseClientFixture()
    const catalog: DatabaseConnectionSummary[] = [
      fixture.state.configuration,
      {
        ...fixture.state.configuration,
        id: '22222222-2222-4222-8222-222222222222',
        alias: 'faturacao-prod',
        environment: 'Production',
        executionHostId: 'runtime:gateway'
      },
      {
        ...fixture.state.configuration,
        id: '33333333-3333-4333-8333-333333333333',
        alias: 'crm-hmg',
        displayName: 'CRM',
        engine: 'sql-server',
        executionHostId: 'runtime:gateway',
        projects: [fixture.options.projects[1].project]
      },
      {
        ...fixture.state.configuration,
        id: '44444444-4444-4444-8444-444444444444',
        alias: 'erp-hmg',
        displayName: 'ERP',
        engine: 'oracle',
        executionHostId: 'runtime:gateway'
      },
      {
        ...fixture.state.configuration,
        id: '55555555-5555-4555-8555-555555555555',
        alias: 'erp-prod',
        displayName: 'ERP',
        environment: 'Production',
        engine: 'oracle',
        executionHostId: 'runtime:gateway',
        projects: fixture.options.projects.map((project) => project.project)
      }
    ]
    if (state === 'empty') {
      fixture.client.catalog = async () => []
    } else if (state === 'error') {
      fixture.client.catalog = async () => {
        throw new Error('The configured database execution host is unavailable')
      }
    } else {
      fixture.client.catalog = async () => catalog
    }
    if (state === 'host-unavailable') {
      fixture.state.configuration.executionHostId = 'runtime:gateway'
      fixture.client.hostCapabilities = async () => {
        throw new Error('db-gateway is unavailable. Reconnect the host to edit this connection.')
      }
    }
    return fixture.client
  }, [state])
  return (
    <ConfirmationDialogProvider>
      <div className="settings-view-shell bg-background p-8 text-foreground">
        <DatabaseConnectionsPane client={client} />
      </div>
    </ConfirmationDialogProvider>
  )
}
export const catalog = defineFixture({ width: 784, render: () => <Preview /> })
export const empty = defineFixture({ width: 784, render: () => <Preview state="empty" /> })
export const error = defineFixture({ width: 784, render: () => <Preview state="error" /> })
export const narrow = defineFixture({ width: 390, render: () => <Preview /> })
export const add = defineFixture({
  width: 1200,
  render: () => <Preview />,
  interact: (frame) => {
    const button = [...frame.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('New connection')
    )
    button?.click()
  }
})
export const hostUnavailable = defineFixture({
  width: 1200,
  render: () => <Preview state="host-unavailable" />,
  interact: (frame) => {
    const button = [...frame.querySelectorAll('button')].find(
      (element) => element.textContent === 'Edit'
    )
    button?.click()
  }
})

export const actions = defineFixture({
  width: 784,
  render: () => <Preview />,
  interact: (frame) => {
    const button = frame.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for @faturacao-hmg"]'
    )
    button?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    )
  }
})

export const clearHistory = defineFixture({
  width: 784,
  render: () => <Preview />,
  interact: async (frame) => {
    const button = frame.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for @faturacao-hmg"]'
    )
    button?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    )
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const action = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes('Clear query history')
    )
    action?.click()
  }
})
