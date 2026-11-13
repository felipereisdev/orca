import { defineFixture } from '../../../component-fixtures/component-fixture'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import type {
  TaskBoardCardsState,
  TaskBoardProviderState
} from '@/lib/work-items/task-board/task-board-provider-results'
import { getDefaultTaskBoardSettings } from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { getSourceOptions } from '../task-page-localized-options'
import { TaskPageOrcaBoard } from './Content'
import type { TaskBoardMove } from './use-task-board-move'

const statuses: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
]

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
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    ...extra
  } as TaskBoardCard
}

function providers(
  status: TaskBoardProviderState['status'],
  overrides: Partial<Record<TaskProvider, TaskBoardProviderState>> = {}
): Record<TaskProvider, TaskBoardProviderState> {
  return {
    github: { status },
    gitlab: { status },
    linear: { status },
    jira: { status },
    ...overrides
  }
}

function move(error: string | null): TaskBoardMove {
  return {
    canDrop: () => ({ ok: true }),
    move: async () => {},
    overrides: new Map(),
    updatingRefKeys: new Set(['gitlab:fixture:#45']),
    dialogs: <span hidden />,
    error,
    clearError: () => {}
  }
}

function Board({
  state,
  error = null
}: {
  state: TaskBoardCardsState
  error?: string | null
}): React.JSX.Element {
  return (
    <TooltipProvider>
      <div className="flex h-[520px] flex-col bg-background p-3">
        <TaskPageOrcaBoard
          state={state}
          statuses={statuses}
          settings={getDefaultTaskBoardSettings()}
          move={move(error)}
          sourceOptions={getSourceOptions()}
          onRefresh={() => {}}
          onOpen={() => {}}
          onStartWorkspace={() => {}}
        />
      </div>
    </TooltipProvider>
  )
}

export const firstLoad = defineFixture({
  width: 1280,
  render: () => <Board state={{ cards: [], providers: providers('loading') }} />
})

export const allDisconnected = defineFixture({
  width: 1280,
  render: () => <Board state={{ cards: [], providers: providers('disconnected') }} />
})

export const cardsWithMoveError = defineFixture({
  width: 1280,
  render: () => (
    <Board
      error="No status change to Done is available for APP-12."
      state={{
        cards: [
          makeCard('jira', 'APP-13', 'Crash when opening a workspace with a long branch name', {
            labels: ['bug', 'p1'],
            priorityLabel: 'High'
          }),
          makeCard('gitlab', '#45', 'Update the onboarding copy'),
          makeCard('jira', 'APP-12', 'Migrate the settings schema', {
            category: 'in-progress',
            statusName: 'In Progress'
          }),
          makeCard('gitlab', '#46', 'Remove the legacy flag', { category: 'done' })
        ],
        providers: providers('ready', {
          github: { status: 'error', error: 'gh is not authenticated on this host.' },
          linear: { status: 'disconnected' }
        })
      }}
    />
  )
})
