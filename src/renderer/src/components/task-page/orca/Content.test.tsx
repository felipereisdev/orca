// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import type { TaskBoardCardsState } from '@/lib/work-items/task-board/task-board-provider-results'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { getSourceOptions } from '../task-page-localized-options'
import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'

type BoardMock = { state: TaskBoardCardsState | null; error: string | null; clearError: Mock }
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
  useTaskBoardCards: () => ({ state: board.state, refresh: vi.fn(), refreshProvider: vi.fn() })
}))
vi.mock('./use-task-board-move', () => ({
  useTaskBoardMove: () => ({
    canDrop: () => ({ ok: true }),
    move: vi.fn(),
    updatingRefKeys: new Set(),
    dialogs: null,
    error: board.error,
    clearError: board.clearError
  })
}))

import { TaskPageOrcaContent } from './Content'

afterEach(() => {
  cleanup()
  board.error = null
})

function card(provider: TaskProvider, displayId: string): TaskBoardCard {
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
    labels: [],
    updatedAt: '2026-11-01T00:00:00Z',
    source: { provider, item: { marker: displayId } }
  } as unknown as TaskBoardCard
}

const cards = [
  card('jira', 'APP-1'),
  card('linear', 'ENG-2'),
  card('gitlab', '#3'),
  card('github', '#4')
]

function renderContent() {
  board.state = {
    cards,
    providers: {
      github: { status: 'ready' },
      gitlab: { status: 'ready' },
      linear: { status: 'ready' },
      jira: { status: 'ready' }
    }
  }
  const handlers = {
    openJiraDetailPage: vi.fn(),
    handleUseJiraItem: vi.fn(),
    openLinearDetailPage: vi.fn(),
    handleOpenOrUseLinearItem: vi.fn(),
    openGitLabDetailPage: vi.fn(),
    handleUseGitLabItem: vi.fn(),
    openGitHubDetailPage: vi.fn(),
    handleOpenOrUseGitHubWorkItem: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every model field this content reads.
  const model = {
    accountBackedTaskSourceHostId: 'local',
    sourceOptions: getSourceOptions(),
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
  it('opens and starts each card through its own provider handlers', () => {
    const handlers = renderContent()
    const expected: [string, keyof typeof handlers, keyof typeof handlers][] = [
      ['APP-1', 'openJiraDetailPage', 'handleUseJiraItem'],
      ['ENG-2', 'openLinearDetailPage', 'handleOpenOrUseLinearItem'],
      ['#3', 'openGitLabDetailPage', 'handleUseGitLabItem'],
      ['#4', 'openGitHubDetailPage', 'handleOpenOrUseGitHubWorkItem']
    ]
    for (const [id, open, start] of expected) {
      fireEvent.click(screen.getByText(`Issue ${id}`))
      fireEvent.click(screen.getByRole('button', { name: `Start workspace from ${id}` }))
      expect(handlers[open]).toHaveBeenCalledExactlyOnceWith({ marker: id })
      expect(handlers[start]).toHaveBeenCalledExactlyOnceWith({ marker: id })
    }
  })

  it('shows a move error until it is dismissed', () => {
    board.error = 'Finish the open move first'
    renderContent()
    expect(screen.getByRole('alert').textContent).toContain('Finish the open move first')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(board.clearError).toHaveBeenCalledOnce()
  })
})
