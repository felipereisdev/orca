import { defineFixture } from '../../../component-fixtures/component-fixture'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TaskBoardProviderState } from '../../../../../shared/task-board/task-board-provider-results'
import type { TaskBoardWireCard } from '../../../../../shared/task-board/task-board-wire-types'
import {
  taskStartPercent,
  type TaskStartRunSummary
} from '../../../../../shared/task-board/task-start-run'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { getSourceOptions } from '../task-page-localized-options'
import { TaskPageOrcaBoard } from './Content'
import type { TaskBoardMove } from './use-task-board-move'
import type { TaskBoardViewState } from './task-board-view-state'

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
  extra: Partial<TaskBoardWireCard> = {}
): TaskBoardWireCard {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the board reads only the project fields of `source.item`; this static fixture supplies just those.
  return {
    refKey: `${provider}:fixture:${displayId}`,
    provider,
    displayId,
    title,
    url: 'https://example.com',
    projectLabel: 'acme/web',
    statusName: 'Open',
    category: 'todo',
    columnId: 'todo',
    moveTargets: [],
    labels: [],
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    source: {
      provider,
      item: { project: { key: 'ACME' }, team: { id: 'acme' }, repoId: 'acme/web' }
    },
    ...extra
  } as TaskBoardWireCard
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

function run(
  fields: Pick<TaskStartRunSummary, 'state' | 'phase'> & Partial<TaskStartRunSummary>
): TaskStartRunSummary {
  return {
    id: `run-${fields.state}-${fields.phase}`,
    updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    worktreeId: 'acme::/work/acme-task',
    percent: taskStartPercent(fields.phase, fields.progress),
    ...fields
  }
}

const runActions = {
  onStart: () => {},
  onStartAs: () => {},
  onStop: () => {},
  onOpenRun: () => {},
  pendingRefKeys: new Set<string>()
}

function Board({
  state,
  error = null
}: {
  state: Omit<TaskBoardViewState, 'columns' | 'error'>
  error?: string | null
}): React.JSX.Element {
  return (
    <TooltipProvider>
      <div className="flex h-[520px] flex-col bg-background p-3">
        <TaskPageOrcaBoard
          state={{ ...state, columns: statuses, error: null }}
          statuses={statuses}
          move={move(error)}
          sourceOptions={getSourceOptions()}
          onRefresh={() => {}}
          onOpen={() => {}}
          onStartWorkspace={() => {}}
          runActions={runActions}
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
            columnId: 'in-progress',
            statusName: 'In Progress',
            progress: {
              worktreeId: 'wt-app-12',
              branch: 'app-12-settings-schema',
              commitsAhead: 3,
              review: { number: 482, url: 'https://example.com/pr/482', state: 'open' },
              checks: 'failure'
            },
            latestComment: {
              author: 'Dana Lee',
              at: new Date().toISOString(),
              excerpt: 'Can we keep the old key readable for one release?'
            },
            unreadComments: 2
          }),
          makeCard('gitlab', '#46', 'Remove the legacy flag', {
            category: 'done',
            columnId: 'completed'
          })
        ],
        providers: providers('ready', {
          github: {
            status: 'error',
            error: { code: 'auth', message: 'gh is not authenticated on this host.' }
          },
          linear: { status: 'disconnected' }
        })
      }}
    />
  )
})

/** No run, Development 3/7 reviewing, Waiting for you, Stopping…, Error and Completed. */
export const taskStartRuns = defineFixture({
  width: 1280,
  render: () => (
    <Board
      state={{
        cards: [
          makeCard('jira', 'APP-20', 'Adjust the invoice filter', {
            labels: ['backend'],
            taskStart: null
          }),
          makeCard('jira', 'APP-21', 'Migrate the settings schema', {
            category: 'in-progress',
            columnId: 'in-progress',
            taskStart: run({
              state: 'running',
              phase: 'development',
              progress: { current: 3, total: 7, step: 'reviewing' }
            })
          }),
          makeCard('gitlab', '#52', 'Ask before deleting stale branches', {
            category: 'in-progress',
            columnId: 'in-progress',
            taskStart: run({ state: 'waiting', phase: 'planning' })
          }),
          makeCard('gitlab', '#53', 'Retire the legacy exporter', {
            category: 'in-progress',
            columnId: 'in-progress',
            taskStart: run({ state: 'stopping', phase: 'qa' })
          }),
          makeCard('jira', 'APP-22', 'Speed up the board list', {
            category: 'in-progress',
            columnId: 'in-review',
            taskStart: run({
              state: 'failed',
              phase: 'final-review',
              failure: 'orchestrator-exited'
            })
          }),
          makeCard('jira', 'APP-23', 'Add retry to the exporter', {
            category: 'done',
            columnId: 'completed',
            taskStart: run({ state: 'completed', phase: 'completed' })
          })
        ],
        providers: providers('ready')
      }}
    />
  )
})
