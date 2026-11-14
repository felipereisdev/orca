import { createElement, type ReactElement, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import type { ConnectionState } from '../../transport/connection/connection-state'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { RpcResponse } from '../../transport/rpc/rpc-wire-types'
import { stubRpcClient } from '../../transport/rpc/rpc-client-test-stub'
import { createOrcaQueryClient } from '../../query/orca-query-client'
import { settleQueryNotifications } from '../../test-support/rpc-recording/hook-mount'
import {
  findAllByHostType,
  findByHostType
} from '../../test-support/react-test-renderer-host-nodes'
import { taskBoardCardsKey } from './task-board-query-storage'

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: ({
      data,
      renderItem,
      ListHeaderComponent,
      ListEmptyComponent
    }: {
      data: { refKey: string }[]
      renderItem: (info: { item: { refKey: string } }) => ReactElement
      ListHeaderComponent: ReactElement
      ListEmptyComponent: ReactElement
    }) =>
      h(
        'FlatList',
        null,
        ListHeaderComponent,
        data.length > 0
          ? data.map((item) => h('Row', { key: item.refKey }, renderItem({ item })))
          : ListEmptyComponent
      ),
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    Pressable: 'Pressable',
    RefreshControl: 'RefreshControl',
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, absoluteFill: {} },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View'
  }
})
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'Icon',
  Check: 'Icon',
  ChevronDown: 'Icon',
  ChevronLeft: 'Icon',
  ChevronRight: 'Icon',
  CircleAlert: 'Icon',
  GitBranch: 'Icon',
  Inbox: 'Icon',
  List: 'Icon',
  Monitor: 'Icon',
  RefreshCw: 'Icon',
  SearchX: 'Icon',
  SlidersHorizontal: 'Icon',
  Unplug: 'Icon',
  WifiOff: 'Icon',
  X: 'Icon'
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ hostId: 'host-1' }) }))
vi.mock('../../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: () => undefined, replace: () => undefined })
}))
// The chrome around the board: the stage tabs stay reachable through the accessory.
vi.mock('../../components/nav-bar/NavBar', () => ({
  NavBar: ({ accessory }: { accessory: ReactNode }) => accessory
}))
vi.mock('../../components/nav-bar/NavBarButton', () => ({ NavBarButton: () => null }))
vi.mock('../../components/nav-bar/FilterChip', () => ({ FilterChip: () => null }))
vi.mock('../../components/MobileSegmentedControl', async () => {
  const { createElement: h } = await import('react')
  return { MobileSegmentedControl: (props: object) => h('Stages', props) }
})
vi.mock('../../components/StatusDot', () => ({ StatusDot: () => null }))
vi.mock('../../components/TaskProviderLogo', () => ({ TaskProviderLogo: () => null }))
vi.mock('../../components/MobileMarkdown', async () => {
  const { createElement: h } = await import('react')
  return { MobileMarkdown: ({ content }: { content: string }) => h('Text', null, content) }
})
vi.mock('../../components/HostOfflineBanner', () => ({
  HostOfflineBanner: () => null,
  useHostOfflineBanner: () => null
}))
vi.mock('../screen/mobile-tasks-host-subtitle', () => ({ MobileTasksHostSubtitle: () => null }))
vi.mock('../../host-catalog/use-host-profile', () => ({ useHostProfile: () => null }))
vi.mock('../../host-descriptors/use-host-display', () => ({
  useHostDisplay: () => ({ title: 'Studio Mac' })
}))
vi.mock('../../platform/haptics', () => ({ triggerSelection: () => undefined }))
// Drawers slide with Reanimated; a shown sheet is just its content here.
vi.mock('../../components/bottom-drawer/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? children : null
}))
vi.mock('../../components/bottom-drawer/keyed-bottom-drawer', async () => {
  const { createElement: h, Fragment } = await import('react')
  return {
    KeyedBottomDrawer: <T,>({
      sheet,
      sheetKey,
      children
    }: {
      sheet: T | null
      sheetKey: (sheet: T) => string
      children: (sheet: T) => ReactNode
    }) => (sheet ? h(Fragment, { key: sheetKey(sheet) }, children(sheet)) : null)
  }
})
vi.mock('../../transport/connection/client-context-connection-metrics', () => ({
  useHostConnectionInputs: () => ({ lastConnectedAt: 1 })
}))
vi.mock('../../transport/connection/connection-health', () => ({
  classifyConnection: () => 'healthy',
  isConnectionOutage: () => false
}))
const link = vi.hoisted((): { client: RpcClient | null; state: ConnectionState } => ({
  client: null,
  state: 'connected'
}))
vi.mock('../../transport/connection/host-client-hooks', () => ({
  useHostClient: () => ({ client: link.client, clientId: null, state: link.state }),
  useForceReconnect: () => null
}))

import { MobileTaskBoardScreen } from './MobileTaskBoardScreen'

const HOST = 'host-1'

function boardCard(columnId: string): TaskBoardWireCard {
  return {
    refKey: 'jira:site-1:ORCA-12',
    provider: 'jira',
    displayId: 'ORCA-12',
    title: 'Ship the board on mobile',
    url: 'https://orca.atlassian.net/browse/ORCA-12',
    projectLabel: 'Orca',
    statusName: columnId === 'done' ? 'Done' : 'In Progress',
    category: columnId === 'done' ? 'done' : 'in-progress',
    labels: [],
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
        labels: [],
        updatedAt: '2026-11-13T10:00:00.000Z',
        createdAt: '2026-11-01T10:00:00.000Z'
      }
    },
    ref: { provider: 'jira', siteId: 'site-1', key: 'ORCA-12' },
    columnId,
    project: { key: 'jira:site-1:ORCA', provider: 'jira', label: 'Orca' },
    moveTargets: ['todo', 'in-progress', 'done']
      .filter((target) => target !== columnId)
      .map((target) => ({ columnId: target, allowed: true }))
  }
}

function board(columnId: string): TaskBoardListResult {
  return {
    columns: [
      { id: 'todo', label: 'To do' },
      { id: 'in-progress', label: 'In progress' },
      { id: 'done', label: 'Done' }
    ],
    doneColumnId: 'done',
    cards: [boardCard(columnId)],
    providers: {
      github: { status: 'disconnected' },
      gitlab: { status: 'disconnected' },
      linear: { status: 'disconnected' },
      jira: { status: 'ready' }
    },
    generatedAt: '2026-11-13T10:00:05.000Z'
  }
}

const moveParams = z.object({
  targetColumnId: z.string(),
  choiceId: z.string().optional(),
  fields: z.object({ resolutionId: z.string().optional() }).optional()
})

function reply(result: unknown): RpcResponse {
  return { id: 'reply', ok: true, result }
}

let tree: ReactTestRenderer | null = null
const queryClients: ReturnType<typeof createOrcaQueryClient>[] = []
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  for (const client of queryClients.splice(0)) {
    client.clear()
  }
})

async function renderBoard(stored: TaskBoardListResult | null): Promise<ReactTestRenderer> {
  const queryClient = createOrcaQueryClient()
  queryClients.push(queryClient)
  if (stored) {
    queryClient.setQueryData(taskBoardCardsKey(HOST), stored, { updatedAt: Date.now() - 60_000 })
  }
  await act(async () => {
    tree = create(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(MobileTaskBoardScreen)
      )
    )
  })
  await settleQueryNotifications()
  if (!tree) {
    throw new Error('the board never rendered')
  }
  return tree
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  const matches = findAllByHostType(root, 'Pressable').filter(
    (node) => node.props.accessibilityLabel === label
  )
  if (matches.length !== 1) {
    throw new Error(`expected one "${label}" control, found ${String(matches.length)}`)
  }
  return matches[0]
}

// A press the way a person makes it, whether or not the control looks enabled.
async function press(root: ReactTestInstance, label: string): Promise<void> {
  await act(async () => {
    pressable(root, label).props.onPress()
  })
  await settleQueryNotifications()
}

async function showStage(root: ReactTestInstance, stageId: string): Promise<void> {
  await act(async () => {
    findByHostType(root, 'Stages').props.onSelect(stageId)
  })
}

// The board's cards are the list rows' buttons that also offer Move to a screen reader.
function shownCards(root: ReactTestInstance): ReactTestInstance[] {
  return findAllByHostType(root, 'Row').flatMap((row) =>
    findAllByHostType(row, 'Pressable').filter(
      (node) => node.props.accessibilityActions !== undefined
    )
  )
}

function shownCardIds(root: ReactTestInstance): string[] {
  return shownCards(root).map((card) => String(card.props.accessibilityLabel).split(',')[0])
}

function shownCardLabel(root: ReactTestInstance): string {
  const [card] = shownCards(root)
  if (!card) {
    throw new Error('no card is shown')
  }
  return String(card.props.accessibilityLabel)
}

describe('moving a card on My board', () => {
  it('sends nothing while the host is unreachable and leaves the card where it was', async () => {
    const sent: string[] = []
    link.state = 'disconnected'
    link.client = stubRpcClient({
      getState: () => 'disconnected',
      sendRequest: (method) => {
        sent.push(method)
        return Promise.reject(new Error(`Not connected: ${HOST}`))
      }
    })
    const root = (await renderBoard(board('in-progress'))).root

    await showStage(root, 'in-progress')
    await press(root, shownCardLabel(root))
    await press(root, 'Move')
    await press(root, 'Done')
    await press(root, 'Move')

    expect(sent).not.toContain('taskBoard.move')
    expect(shownCardIds(root)).toEqual(['ORCA-12'])
    await showStage(root, 'done')
    expect(shownCardIds(root)).toEqual([])
  })

  it('finishes a move that needs a resolution with the card in the target column', async () => {
    let column = 'in-progress'
    link.state = 'connected'
    link.client = stubRpcClient({
      sendRequest: async (method, params) => {
        switch (method) {
          case 'status.get':
            return { id: 'reply', ok: false, error: { code: 'unavailable', message: 'no status' } }
          case 'taskBoard.list':
            return reply(board(column))
          case 'taskBoard.move': {
            const request = moveParams.parse(params)
            if (request.choiceId !== '31') {
              return reply({
                status: 'needs-fields',
                choice: {
                  id: '31',
                  name: 'Resolve',
                  fields: {
                    resolution: {
                      name: 'Resolution',
                      required: true,
                      options: [
                        { id: '1', name: 'Fixed' },
                        { id: '2', name: "Won't do" }
                      ]
                    },
                    commentRequired: false
                  }
                }
              })
            }
            if (request.fields?.resolutionId !== '1') {
              return reply({ status: 'failed', error: 'Resolution is required' })
            }
            column = request.targetColumnId
            return reply({ status: 'moved', card: boardCard(column) })
          }
          default:
            throw new Error(`unscripted request: ${method}`)
        }
      }
    })
    const root = (await renderBoard(null)).root

    await showStage(root, 'in-progress')
    await act(async () => {
      pressable(root, shownCardLabel(root)).props.onLongPress()
    })
    await press(root, 'Done')
    await press(root, 'Move')
    await press(root, 'Fixed')
    await press(root, 'Move')

    await showStage(root, 'done')
    expect(shownCardIds(root)).toEqual(['ORCA-12'])
    await showStage(root, 'in-progress')
    expect(shownCardIds(root)).toEqual([])
  })
})
