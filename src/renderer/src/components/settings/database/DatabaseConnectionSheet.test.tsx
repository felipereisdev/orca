// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ConfirmationDialogProvider } from '../../confirmation-dialog'
import { DatabaseConnectionSheet } from './DatabaseConnectionSheet'
import { createDatabaseClientFixture } from './testing/database-client-fixture'

afterEach(cleanup)
it('persists project selection and refuses an endpoint update from a stale edit form', async () => {
  const { client, options, state } = createDatabaseClientFixture()
  const open = () =>
    render(
      <ConfirmationDialogProvider>
        <DatabaseConnectionSheet
          client={client}
          connectionId={state.configuration.id}
          options={options}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </ConfirmationDialogProvider>
    )
  open()
  await screen.findByDisplayValue('faturacao-hmg')
  fireEvent.click(screen.getByRole('combobox', { name: 'Associated projects' }))
  fireEvent.click(screen.getByRole('option', { name: /CRM/ }))
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() =>
    expect(state.configuration.projects).toEqual([
      { kind: 'repository', projectId: 'billing', executionHostId: 'local' },
      { kind: 'folder', projectId: 'crm', executionHostId: 'local' }
    ])
  )
  cleanup()
  open()
  await screen.findByDisplayValue('original-db')
  state.configuration = { ...state.configuration, revision: 9 }
  fireEvent.change(screen.getByRole('textbox', { name: 'Server' }), {
    target: { value: 'stale-db' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await screen.findByRole('alert')
  expect(state.configuration.endpoint.server).toBe('original-db')
})

it('keeps certificate verification by default and persists an explicit SQL Server trust choice', async () => {
  const { client, options, state } = createDatabaseClientFixture()
  state.configuration = { ...state.configuration, engine: 'sql-server' }
  const open = () =>
    render(
      <ConfirmationDialogProvider>
        <DatabaseConnectionSheet
          client={client}
          connectionId={state.configuration.id}
          options={options}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </ConfirmationDialogProvider>
    )
  open()
  const trust = await screen.findByRole('checkbox', { name: 'Trust server certificate' })
  expect(trust.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(trust)
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(state.configuration.endpoint.tls.trustServerCertificate).toBe(true))
  cleanup()
  open()
  expect(
    (await screen.findByRole('checkbox', { name: 'Trust server certificate' })).getAttribute(
      'aria-checked'
    )
  ).toBe('true')
})

it('persists full SQL access and restores read-only access when selected again', async () => {
  const { client, options, state } = createDatabaseClientFixture()
  render(
    <ConfirmationDialogProvider>
      <DatabaseConnectionSheet
        client={client}
        connectionId={state.configuration.id}
        options={options}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </ConfirmationDialogProvider>
  )
  const mode = await screen.findByRole('combobox', { name: 'Access mode' })
  fireEvent.click(mode)
  fireEvent.click(await screen.findByRole('option', { name: 'Read and write' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(state.configuration).toMatchObject({ accessMode: 'read-write' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Access mode' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Read only' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(state.configuration).toMatchObject({ accessMode: 'read-only' }))
})
