// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { DatabaseExplorerPane } from './DatabaseExplorerPane'
import { createDatabaseExplorerState } from './database-explorer-state'
import { createDatabaseClientFixture } from '../settings/database/testing/database-client-fixture'

const editor = vi.hoisted(() => vi.fn())
vi.mock('../editor/MonacoEditor', () => ({
  default: (props: { fileId: string; viewStateKey: string; content: string }) => {
    editor(props)
    return null
  }
}))

it('assigns independent stable editor ownership to explorers in the same workspace', async () => {
  const { client, state } = createDatabaseClientFixture()
  client.controllerIdentity = async () => 'controller'
  client.status = async () => ({
    runtimeId: 'controller',
    rendererGraphEpoch: 1,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0
  })
  client.list = async () => [state.configuration]
  client.describe = async () => ({ schemas: [], tables: [], columns: [], truncated: false })
  const first = createDatabaseExplorerState({
    connectionId: state.configuration.id,
    controllerRuntimeId: 'controller'
  })
  const second = createDatabaseExplorerState({
    connectionId: state.configuration.id,
    controllerRuntimeId: 'controller'
  })
  first.edit('SELECT 11')
  second.edit('SELECT 22')
  const view = render(
    <>
      <DatabaseExplorerPane
        client={client}
        controller={first}
        worktreeId="workspace"
        entityId="explorer-a"
      />
      <DatabaseExplorerPane
        client={client}
        controller={second}
        worktreeId="workspace"
        entityId="explorer-b"
      />
    </>
  )
  await waitFor(() => {
    expect(editor).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'database:workspace:explorer-a', content: 'SELECT 11' })
    )
    expect(editor).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'database:workspace:explorer-b', content: 'SELECT 22' })
    )
  })
  first.selectConnection({ connectionId: 'another-connection', controllerRuntimeId: 'controller' })
  view.rerender(
    <>
      <DatabaseExplorerPane
        client={client}
        controller={first}
        worktreeId="workspace"
        entityId="explorer-a"
      />
      <DatabaseExplorerPane
        client={client}
        controller={second}
        worktreeId="workspace"
        entityId="explorer-b"
      />
    </>
  )
  await waitFor(() =>
    expect(editor).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'database:workspace:explorer-a',
        viewStateKey: 'database:workspace:explorer-a',
        content: 'SELECT 11'
      })
    )
  )
  view.unmount()
})
