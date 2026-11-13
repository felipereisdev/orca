import { defineFixture } from '../../component-fixtures/component-fixture'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import type { TaskProvider } from '../../../../shared/work-items/task-providers'
import { TaskBoard, type TaskBoardColumn } from './TaskBoard'

function makeCard(
  provider: TaskProvider,
  displayId: string,
  title: string,
  extra: Partial<TaskBoardCard> = {}
): TaskBoardCard {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the board never reads `source`; this static fixture omits it.
  return {
    refKey: `${provider}:fixture:${displayId}`,
    provider,
    displayId,
    title,
    url: 'https://example.com',
    projectLabel: 'acme/web',
    statusName: 'Open',
    category: 'todo',
    labels: [],
    updatedAt: '2h ago',
    ...extra
  } as TaskBoardCard
}

const columns: TaskBoardColumn[] = [
  {
    id: 'todo',
    label: 'Todo',
    status: { id: 'todo', label: 'Todo' },
    cards: [
      makeCard('github', '#123', 'Crash when opening a workspace with a very long branch name', {
        labels: ['bug', 'p1', 'ui', 'regression']
      }),
      makeCard('gitlab', '#45', 'Update the onboarding copy')
    ]
  },
  {
    id: 'in-progress',
    label: 'In progress',
    status: { id: 'in-progress', label: 'In progress' },
    cards: [
      makeCard('linear', 'ENG-77', 'Sync task statuses across hosts', { priorityLabel: 'High' }),
      makeCard('jira', 'PROJ-9', 'Migrate the settings schema', { labels: ['backend'] })
    ]
  },
  {
    id: 'completed',
    label: 'Done',
    status: { id: 'completed', label: 'Done' },
    cards: []
  }
]

export const allProviders = defineFixture({
  width: 1100,
  render: () => (
    <div className="bg-background">
      <TaskBoard
        columns={columns}
        canDrop={(_card, columnId) =>
          columnId === 'completed' ? { ok: false, reason: 'No done status mapped' } : { ok: true }
        }
        onMove={async () => {}}
        onOpen={() => {}}
        onStartWorkspace={() => {}}
        updatingRefKeys={new Set()}
        selectedRefKey="linear:fixture:ENG-77"
        formatUpdatedAt={(value) => value}
      />
    </div>
  )
})
