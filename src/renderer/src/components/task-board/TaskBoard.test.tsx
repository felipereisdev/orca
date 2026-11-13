// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import { TaskBoard, type TaskBoardColumn } from './TaskBoard'

function makeDataTransfer(): DataTransfer {
  const data = new Map<string, string>()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: happy-dom has no DataTransfer; the board uses only these members.
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return Array.from(data.keys())
    }
  } as unknown as DataTransfer
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the board reads only the flat fields, never `source`.
const card = {
  refKey: 'github:repo:1',
  provider: 'github',
  displayId: '#1',
  title: 'Fix bug',
  url: 'https://example.com/1',
  projectLabel: 'owner/repo',
  statusName: 'Open',
  category: 'todo',
  labels: [],
  updatedAt: '2026-11-01T00:00:00Z'
} as unknown as TaskBoardCard

const columns: TaskBoardColumn[] = [
  { id: 'todo', label: 'Todo', status: { id: 'todo', label: 'Todo' }, cards: [card] },
  {
    id: 'in-progress',
    label: 'In progress',
    status: { id: 'in-progress', label: 'In progress' },
    cards: []
  },
  { id: 'blocked', label: 'Blocked', status: { id: 'blocked', label: 'Blocked' }, cards: [] }
]

function setup() {
  const onMove = vi.fn(async () => {})
  render(
    <TooltipProvider>
      <TaskBoard
        columns={columns}
        canDrop={(_card, columnId) =>
          columnId === 'blocked' ? { ok: false, reason: 'x' } : { ok: true }
        }
        onMove={onMove}
        onOpen={vi.fn()}
        onStartWorkspace={vi.fn()}
        updatingRefKeys={new Set()}
        selectedRefKey={null}
        formatUpdatedAt={(value) => value}
      />
    </TooltipProvider>
  )
  const dataTransfer = makeDataTransfer()
  const cardEl = screen.getByText('Fix bug').closest('[role="button"]')
  if (!cardEl) {
    throw new Error('card not rendered')
  }
  fireEvent.dragStart(cardEl, { dataTransfer })
  return { onMove, dataTransfer }
}

function columnOf(label: string): HTMLElement {
  const section = screen.getByText(label).closest('section')
  if (!section) {
    throw new Error(`column ${label} not rendered`)
  }
  return section
}

afterEach(cleanup)

describe('TaskBoard drag and drop', () => {
  it('ignores a drop on a column that canDrop rejects', () => {
    const { onMove, dataTransfer } = setup()
    const blocked = columnOf('Blocked')
    fireEvent.dragOver(blocked, { dataTransfer })
    fireEvent.drop(blocked, { dataTransfer })
    expect(onMove).not.toHaveBeenCalled()
  })

  it('moves the card when dropped on an allowed column', () => {
    const { onMove, dataTransfer } = setup()
    const target = columnOf('In progress')
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(onMove).toHaveBeenCalledWith(card, 'in-progress')
  })

  it('treats a drop on the card own column as a no-op', () => {
    const { onMove, dataTransfer } = setup()
    fireEvent.drop(columnOf('Todo'), { dataTransfer })
    expect(onMove).not.toHaveBeenCalled()
  })
})
