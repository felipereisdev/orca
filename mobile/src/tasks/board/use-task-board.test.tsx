import { createElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskBoardListResult } from '../../../../src/shared/task-board/task-board-wire-types'
import type { OrcaQueryStoreBackend } from '../../device-store/query-storage'
import { createHostQueryPersistence } from '../../query/host-query-persistence'
import { createOrcaQueryClient } from '../../query/orca-query-client'
import { settleQueryNotifications } from '../../test-support/rpc-recording/hook-mount'
import { stubRpcClient } from '../../transport/rpc/rpc-client-test-stub'
import { taskBoardCardsKey, taskBoardCardsStorage } from './task-board-query-storage'
import { useTaskBoard } from './use-task-board'

vi.mock('react-native', () => ({ AppState: {} }))

// The phone lost the host: every read fails the way failWhenDisconnected does.
const unreachable = stubRpcClient({
  getState: () => 'disconnected',
  sendRequest: () => Promise.reject(new Error('Not connected: host-1'))
})
vi.mock('../../transport/connection/host-client-hooks', () => ({
  useHostClient: () => ({ client: unreachable, clientId: null, state: 'disconnected' })
}))

const HOST = 'host-1'

const storedBoard: TaskBoardListResult = {
  columns: [
    { id: 'todo', label: 'To do' },
    { id: 'in-progress', label: 'In progress' },
    { id: 'done', label: 'Done' }
  ],
  doneColumnId: 'done',
  cards: [
    {
      refKey: 'jira:site-1:ORCA-12',
      provider: 'jira',
      displayId: 'ORCA-12',
      title: 'Ship the board on mobile',
      url: 'https://orca.atlassian.net/browse/ORCA-12',
      projectLabel: 'Orca',
      statusName: 'In Progress',
      category: 'in-progress',
      labels: ['mobile'],
      updatedAt: '2026-11-13T10:00:00.000Z',
      source: {
        provider: 'jira',
        item: {
          id: '10012',
          key: 'ORCA-12',
          siteId: 'site-1',
          title: 'Ship the board on mobile',
          url: 'https://orca.atlassian.net/browse/ORCA-12',
          project: { id: '1', key: 'ORCA', name: 'Orca' },
          issueType: { id: '3', name: 'Task' },
          status: {
            id: '3',
            name: 'In Progress',
            categoryKey: 'indeterminate',
            categoryName: 'In Progress'
          },
          labels: ['mobile'],
          updatedAt: '2026-11-13T10:00:00.000Z',
          createdAt: '2026-11-01T10:00:00.000Z'
        }
      },
      ref: { provider: 'jira', siteId: 'site-1', key: 'ORCA-12' },
      columnId: 'in-progress',
      project: { key: 'jira:site-1:ORCA', provider: 'jira', label: 'Orca' },
      moveTargets: [
        { columnId: 'todo', allowed: true },
        { columnId: 'done', allowed: true }
      ],
      unreadComments: 2
    }
  ],
  providers: {
    github: { status: 'disconnected' },
    gitlab: { status: 'disconnected' },
    linear: { status: 'disconnected' },
    jira: { status: 'ready' }
  },
  generatedAt: '2026-11-13T10:00:05.000Z'
}

function memoryStore(): OrcaQueryStoreBackend {
  const rows = new Map<string, string>()
  return {
    hostId: HOST,
    read: async (keys) => ({
      status: 'ok',
      values: keys.map((storeKey) => rows.get(storeKey) ?? null)
    }),
    write: async (ops) => {
      for (const op of ops) {
        if (op.value === null) {
          rows.delete(op.key)
        } else {
          rows.set(op.key, op.value)
        }
      }
      return { written: true }
    }
  }
}

// What an earlier launch leaves on the phone: the board it last read, flushed to the store.
async function storeFromEarlierLaunch(store: OrcaQueryStoreBackend): Promise<void> {
  const earlier = createOrcaQueryClient()
  const persistence = createHostQueryPersistence(earlier, store)
  const key = taskBoardCardsKey(HOST)
  earlier.getQueryCache().build(earlier, {
    queryKey: key,
    meta: { persist: taskBoardCardsStorage.persist }
  })
  earlier.setQueryData(key, storedBoard, { updatedAt: Date.now() - 3_600_000 })
  await settleQueryNotifications()
  await persistence.flush()
  persistence.stop()
  earlier.clear()
}

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

describe('useTaskBoard', () => {
  it('shows the board an earlier launch stored while the host is unreachable', async () => {
    const store = memoryStore()
    await storeFromEarlierLaunch(store)

    const relaunched = createOrcaQueryClient()
    createHostQueryPersistence(relaunched, store)
    let board: ReturnType<typeof useTaskBoard> | null = null
    function Probe() {
      board = useTaskBoard(HOST)
      return null
    }
    await act(async () => {
      tree = create(
        createElement(QueryClientProvider, { client: relaunched }, createElement(Probe))
      )
    })
    await settleQueryNotifications()

    expect(board).toMatchObject({
      isOffline: true,
      unsupported: false,
      data: {
        doneColumnId: 'done',
        cards: [{ refKey: 'jira:site-1:ORCA-12', columnId: 'in-progress', unreadComments: 2 }]
      }
    })
    relaunched.clear()
  })
})
