// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import type * as GraphPublication from '@/runtime/sync-runtime-graph/graph-publication'
import { registerSessionTabIpcBridge } from './session-tab-ipc-bridge'
import type {
  DatabaseTabOpenRequest,
  DatabaseTabOpenResponse
} from '../../../../shared/database/database-tab-open'

const publication = vi.hoisted<{ finish: (() => void) | null }>(() => ({ finish: null }))
vi.mock('@/runtime/sync-runtime-graph/graph-publication', async (importOriginal) => ({
  ...(await importOriginal<typeof GraphPublication>()),
  syncRuntimeGraph: () =>
    new Promise<void>((resolve) => {
      publication.finish = resolve
    })
}))
const initial = useAppStore.getInitialState()
afterEach(() => {
  useAppStore.setState(initial, true)
  vi.unstubAllGlobals()
})

it('acknowledges an actual background database tab only after publication without moving desktop selection', async () => {
  useAppStore.setState(
    {
      ...initial,
      worktreesByRepo: {
        repo: [makeWorktree({ id: 'workspace', repoId: 'repo', path: '/fixture' })]
      },
      activeWorktreeId: 'workspace',
      groupsByWorktree: {
        workspace: [{ id: 'group', worktreeId: 'workspace', activeTabId: null, tabOrder: [] }]
      },
      activeGroupIdByWorktree: { workspace: 'group' }
    },
    true
  )
  let open: ((request: DatabaseTabOpenRequest) => void) | undefined
  let acknowledged: DatabaseTabOpenResponse | undefined
  vi.stubGlobal('window', {
    api: {
      ui: {
        onDatabaseTabOpenRequest: (listener: typeof open) => {
          open = listener
          return () => {}
        },
        respondDatabaseTabOpen: (response: DatabaseTabOpenResponse) => {
          acknowledged = response
        },
        onCloseSessionTab: () => () => {},
        onSessionTabCloseRequest: () => () => {},
        onMoveSessionTab: () => () => {}
      }
    }
  })
  useAppStore.getState().createUnifiedTab('workspace', 'database', {
    id: 'desktop-tab',
    entityId:
      '{"connectionId":"22222222-2222-4222-8222-222222222222","controllerRuntimeId":"controller"}',
    label: 'Existing'
  })
  registerSessionTabIpcBridge([])
  const entityId =
    '{"connectionId":"11111111-1111-4111-8111-111111111111","controllerRuntimeId":"controller"}'
  open!({
    requestId: 'open-one',
    worktreeId: 'workspace',
    entityId,
    tabId: 'database-tab',
    title: 'Reporting'
  })
  expect(
    useAppStore.getState().unifiedTabsByWorktree.workspace?.find((tab) => tab.id === 'database-tab')
  ).toMatchObject({ id: 'database-tab', contentType: 'database', entityId, label: 'Reporting' })
  expect(useAppStore.getState().groupsByWorktree.workspace?.[0]?.activeTabId).toBe('desktop-tab')
  expect(acknowledged).toBeUndefined()
  publication.finish!()
  await Promise.resolve()
  expect(acknowledged).toEqual({ requestId: 'open-one', tabId: 'database-tab' })
  open!({
    requestId: 'open-two',
    worktreeId: 'workspace',
    entityId,
    tabId: 'duplicate-tab',
    title: 'Reporting'
  })
  publication.finish!()
  await Promise.resolve()
  expect(acknowledged).toEqual({ requestId: 'open-two', tabId: 'database-tab' })
  expect(useAppStore.getState().unifiedTabsByWorktree.workspace?.map((tab) => tab.id)).toEqual([
    'desktop-tab',
    'database-tab'
  ])
})
