// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { NativeChatDatabaseQueryCard } from './NativeChatDatabaseQueryCard'
import { openDatabaseExplorer } from '@/lib/database/database-explorer-tabs'
vi.mock('@/lib/database/database-explorer-tabs', () => ({ openDatabaseExplorer: vi.fn() }))
it('opens the older recorded execution after a newer query card is rendered', () => {
  const source = {
    connectionId: '11111111-1111-4111-8111-111111111111',
    connectionRevision: 1,
    alias: 'faturacao-hmg',
    engine: 'postgres' as const,
    environment: 'HMG',
    executionHostId: 'local' as const,
    controllerRuntimeId: 'controller'
  }
  const view = render(
    <>
      <NativeChatDatabaseQueryCard
        worktreeId="folder:crm"
        sessionId="agent-a"
        controllerRuntimeId="controller"
        queryId="11111111-1111-4111-8111-111111111112"
        source={source}
        status="completed"
      />
      <NativeChatDatabaseQueryCard
        worktreeId="folder:crm"
        sessionId="agent-a"
        controllerRuntimeId="controller"
        queryId="11111111-1111-4111-8111-111111111113"
        source={source}
        status="completed"
      />
    </>
  )
  fireEvent.click(view.getAllByRole('button')[0])
  expect(openDatabaseExplorer).toHaveBeenCalledWith({
    worktreeId: 'folder:crm',
    sessionId: 'agent-a',
    connection: {
      connectionId: '11111111-1111-4111-8111-111111111111',
      controllerRuntimeId: 'controller'
    },
    queryId: '11111111-1111-4111-8111-111111111112'
  })
})
