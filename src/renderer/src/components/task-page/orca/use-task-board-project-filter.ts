import { useMemo, useState } from 'react'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import {
  listTaskBoardProjects,
  type TaskBoardProject,
  type TaskBoardProjectOption
} from '@/lib/work-items/task-board/task-board-project-filter'
import {
  readTaskBoardProjectSelection,
  writeTaskBoardProjectSelection
} from './task-board-session-cache'

export function useTaskBoardProjectFilter(cards: readonly TaskBoardCard[]): {
  selection: ReadonlyMap<string, TaskBoardProject>
  options: TaskBoardProjectOption[]
  toggle: (option: TaskBoardProjectOption) => void
  clear: () => void
} {
  const [selection, setSelection] = useState(readTaskBoardProjectSelection)
  const options = useMemo(() => listTaskBoardProjects(cards, selection), [cards, selection])
  const commit = (next: ReadonlyMap<string, TaskBoardProject>): void => {
    setSelection(next)
    writeTaskBoardProjectSelection(next)
  }
  return {
    selection,
    options,
    toggle: (option) => {
      const next = new Map(selection)
      if (!next.delete(option.key)) {
        next.set(option.key, { key: option.key, provider: option.provider, label: option.label })
      }
      commit(next)
    },
    clear: () => commit(new Map())
  }
}
