// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TaskBoardWireCard } from '../../../../../shared/task-board/task-board-wire-types'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { getSourceOptions } from '../task-page-localized-options'
import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import type { TaskBoardViewState } from './task-board-view-state'

type BoardMock = { state: TaskBoardViewState | null; error: string | null; clearError: Mock }
const board = vi.hoisted((): BoardMock => ({ state: null, error: null, clearError: vi.fn() }))
const statuses: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'completed', label: 'Done' }
]

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ workspaceStatuses: statuses, settings: undefined })
}))
vi.mock('./use-task-board-cards', () => ({
  useTaskBoardCards: () => ({ state: board.state, refresh: vi.fn(), reread: vi.fn() })
}))
vi.mock('./use-task-board-move', () => ({
  useTaskBoardMove: () => ({
    canDrop: () => ({ ok: true }),
    move: vi.fn(),
    overrides: new Map(),
    updatingRefKeys: new Set(),
    dialogs: null,
    error: board.error,
    clearError: board.clearError
  })
}))

import { TaskPageOrcaContent } from './Content'
import { writeTaskBoardProjectSelection } from './task-board-session-cache'

afterEach(() => {
  cleanup()
  board.error = null
  writeTaskBoardProjectSelection(new Map())
})

// The fields project filtering reads from each provider's item.
const projectFields = { project: { key: 'APP' }, team: { id: 'eng' }, repoId: 'acme' }

function card(
  provider: TaskProvider,
  displayId: string,
  extra: Partial<TaskBoardWireCard> = {}
): TaskBoardWireCard {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the page hands `item` to the handlers untouched; a marker stands in for the provider item.
  return {
    refKey: `${provider}:test:${displayId}`,
    provider,
    displayId,
    title: `Issue ${displayId}`,
    url: `https://example.com/${displayId}`,
    projectLabel: 'acme',
    statusName: 'Open',
    category: 'todo',
    columnId: 'todo',
    moveTargets: [],
    labels: [],
    updatedAt: '2026-11-01T00:00:00Z',
    source: { provider, item: { marker: displayId, ...projectFields } },
    ...extra
  } as unknown as TaskBoardWireCard
}

const cards = [
  card('jira', 'APP-1'),
  card('linear', 'ENG-2'),
  card('gitlab', '#3'),
  card('github', '#4')
]

function renderContent(boardCards = cards) {
  board.state = {
    cards: boardCards,
    columns: statuses,
    error: null,
    providers: {
      github: { status: 'ready' },
      gitlab: { status: 'ready' },
      linear: { status: 'ready' },
      jira: { status: 'ready' }
    }
  }
  const handlers = {
    openJiraDetailPage: vi.fn(),
    openLinearDetailPage: vi.fn(),
    openGitLabDetailPage: vi.fn(),
    openGitHubDetailPage: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every model field this content reads.
  const model = {
    accountBackedTaskSourceHostId: 'local',
    visibleSourceOptions: getSourceOptions(),
    ...handlers
  } as unknown as TaskPageComposerActionsModel
  render(
    <TooltipProvider>
      <TaskPageOrcaContent model={model} />
    </TooltipProvider>
  )
  return handlers
}

describe('TaskPageOrcaContent', () => {
  it('opens each card through its own provider handler', () => {
    const handlers = renderContent()
    const expected: [string, keyof typeof handlers][] = [
      ['APP-1', 'openJiraDetailPage'],
      ['ENG-2', 'openLinearDetailPage'],
      ['#3', 'openGitLabDetailPage'],
      ['#4', 'openGitHubDetailPage']
    ]
    for (const [id, open] of expected) {
      fireEvent.click(screen.getByText(`Issue ${id}`))
      expect(handlers[open]).toHaveBeenCalledExactlyOnceWith({ marker: id, ...projectFields })
    }
  })

  it('shows only the cards of the selected projects', () => {
    writeTaskBoardProjectSelection(
      new Map([['jira::APP', { key: 'jira::APP', provider: 'jira', label: 'acme' }]])
    )
    renderContent()
    expect(screen.queryByText('Issue APP-1')).not.toBeNull()
    expect(screen.queryByText('Issue ENG-2')).toBeNull()
    expect(screen.queryByText('Issue #3')).toBeNull()
  })

  it('places a card in the column the host chose, not the one its status category suggests', () => {
    renderContent([card('jira', 'APP-7', { category: 'todo', columnId: 'completed' })])
    const done = screen.getByText('Done').closest('section')
    const todo = screen.getByText('Todo').closest('section')
    expect(done && within(done).queryByText('Issue APP-7')).not.toBeNull()
    expect(todo && within(todo).queryByText('Issue APP-7')).toBeNull()
  })

  it('shows a move error until it is dismissed', () => {
    board.error = 'Finish the open move first'
    renderContent()
    expect(screen.getByRole('alert').textContent).toContain('Finish the open move first')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(board.clearError).toHaveBeenCalledOnce()
  })
})
