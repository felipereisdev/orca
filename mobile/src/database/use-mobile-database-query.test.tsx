import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseConnectionRef } from '../../../src/shared/database/database-contracts'
import type {
  DatabaseQueryRecord,
  DatabaseQuerySnapshot
} from '../../../src/shared/database/database-query-contracts'
import type { MobileDatabaseClient } from './mobile-database-rpc'
import { useMobileDatabaseQuery } from './use-mobile-database-query'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const connection: DatabaseConnectionRef = {
  connectionId: 'connection-a',
  controllerRuntimeId: 'controller-a'
}
const record: DatabaseQueryRecord = {
  queryId: 'query-a',
  source: {
    connectionId: 'connection-a',
    controllerRuntimeId: 'controller-a',
    connectionRevision: 1,
    alias: 'app',
    engine: 'postgres',
    environment: 'dev',
    executionHostId: 'local'
  },
  project: { kind: 'folder', projectId: 'folder-a', executionHostId: 'local' },
  sessionId: 'phone-a',
  sql: 'SELECT 1',
  parameterNames: [],
  createdAt: 1,
  finishedAt: 2,
  status: 'completed',
  rowCount: 0,
  truncated: false
}
const completed: DatabaseQuerySnapshot = {
  status: 'completed',
  record,
  columns: [],
  rows: [],
  rowCount: 0,
  truncated: false,
  limits: { timeoutMs: 30_000, maxRows: 1000, maxOutputBytes: 1024 }
}

function database(overrides: Partial<MobileDatabaseClient> = {}): MobileDatabaseClient {
  return {
    status: async () => ({}),
    controllerIdentity: async () => 'controller-a',
    list: async () => [],
    describe: async () => ({ schemas: [], tables: [], columns: [], truncated: false }),
    start: async () => ({ queryId: 'query-a', source: record.source }),
    wait: async () => completed,
    result: async () => completed,
    cancel: async () => {},
    history: async () => [],
    ...overrides
  }
}

let tree: ReactTestRenderer | null = null
afterEach(() =>
  act(() => {
    tree?.unmount()
    tree = null
  })
)

function harness(api: MobileDatabaseClient) {
  let current: ReturnType<typeof useMobileDatabaseQuery> | null = null
  function Probe({ client }: { client: MobileDatabaseClient }) {
    current = useMobileDatabaseQuery(client, connection)
    return null
  }
  const read = () => {
    if (!current) {
      throw new Error('Not mounted')
    }
    return current
  }
  return {
    read,
    mount: async () => {
      await act(async () => {
        tree = create(createElement(Probe, { client: api }))
      })
    },
    replace: async (client: MobileDatabaseClient) => {
      await act(async () => tree?.update(createElement(Probe, { client })))
    }
  }
}

describe('mobile database query ownership', () => {
  it('refuses execution after the saved connection controller changes', async () => {
    let identity = 'controller-a'
    const view = harness(database({ controllerIdentity: async () => identity }))
    await view.mount()
    identity = 'controller-b'
    await act(async () => {
      await view.read().execute('DELETE FROM obsolete_rows')
    })
    expect(view.read().queryId).toBeNull()
    expect(view.read().starting).toBe(false)
  })

  it('locks duplicate submission and recovers an existing result without executing SQL again', async () => {
    const start = deferred<{ queryId: string; source: typeof record.source }>()
    let submitted = false
    const api = database({
      start: async () => {
        if (submitted) {
          throw new Error('SQL was submitted again')
        }
        submitted = true
        return start.promise
      },
      wait: async () => {
        throw new Error('Disconnected')
      }
    })
    const view = harness(api)
    await view.mount()
    let first!: Promise<void>
    await act(async () => {
      first = view.read().execute('SELECT 1')
      await view.read().execute('SELECT 2')
    })
    expect(view.read().starting).toBe(true)
    await act(async () => {
      start.resolve({ queryId: 'query-a', source: record.source })
      await first
    })
    expect(view.read().queryId).toBe('query-a')
    expect(view.read().error).toBe('Disconnected')
    await act(async () => {
      await view.read().retryResult()
    })
    expect(view.read().snapshot?.status).toBe('completed')
    expect(view.read().error).toBeNull()
  })

  it('ignores the previous host result after changing API and leaves its query on the server', async () => {
    const waiting = deferred<DatabaseQuerySnapshot>()
    const api = database({
      wait: () => waiting.promise,
      cancel: async () => {
        throw new Error('Unmount must not cancel')
      }
    })
    const view = harness(api)
    await view.mount()
    let execution!: Promise<void>
    await act(async () => {
      execution = view.read().execute('SELECT 1')
    })
    expect(view.read().running).toBe(true)
    await view.replace(database())
    await act(async () => {
      waiting.resolve(completed)
      await execution
    })
    expect(view.read().queryId).toBeNull()
    expect(view.read().snapshot).toBeNull()
    expect(view.read().error).toBeNull()
  })

  it('filters foreign history and cancels only the currently opened query', async () => {
    const waiting = deferred<DatabaseQuerySnapshot>()
    const cancelled: DatabaseQuerySnapshot = {
      status: 'cancelled',
      record: { ...record, status: 'cancelled' }
    }
    let stopped = false
    const api = database({
      history: async () => [
        record,
        {
          ...record,
          queryId: 'foreign',
          source: { ...record.source, connectionId: 'connection-b' }
        }
      ],
      result: async () =>
        stopped ? cancelled : { status: 'running', record: { ...record, status: 'running' } },
      wait: () =>
        stopped
          ? Promise.reject(new Error('Cancelled query must not resume polling'))
          : waiting.promise,
      cancel: async (queryId) => {
        if (queryId !== 'query-a') {
          throw new Error('Wrong query cancelled')
        }
        stopped = true
      }
    })
    const view = harness(api)
    await view.mount()
    expect(view.read().history.map((entry) => entry.queryId)).toEqual(['query-a'])
    let opening!: Promise<void>
    await act(async () => {
      opening = view.read().openQuery(record)
    })
    expect(view.read().running).toBe(true)
    await act(async () => {
      await view.read().cancel()
    })
    expect(view.read().snapshot?.status).toBe('cancelled')
    await act(async () => {
      waiting.resolve({ status: 'running', record: { ...record, status: 'running' } })
      await opening
    })
    expect(view.read().snapshot?.status).toBe('cancelled')
    expect(view.read().running).toBe(false)
  })

  it('allows result recovery when cancellation is refused by the host', async () => {
    const waiting = deferred<DatabaseQuerySnapshot>()
    const view = harness(
      database({
        wait: () => waiting.promise,
        cancel: async () => {
          throw new Error('Host disconnected')
        },
        result: async (queryId) => {
          if (queryId !== 'query-a') {
            throw new Error('Wrong result requested')
          }
          return completed
        }
      })
    )
    await view.mount()
    let execution!: Promise<void>
    await act(async () => {
      execution = view.read().execute('SELECT 1')
    })
    await act(async () => {
      await view.read().cancel()
    })
    expect(view.read().running).toBe(false)
    expect(view.read().error).toBe('Host disconnected')
    await act(async () => {
      await view.read().retryResult()
    })
    expect(view.read().snapshot?.status).toBe('completed')
    await act(async () => {
      waiting.resolve(completed)
      await execution
    })
  })
})
