import { defineFixture } from '../../component-fixtures/component-fixture'
import type { TaskBoardWireCard } from '../../../../shared/task-board/task-board-wire-types'
import {
  taskStartPercent,
  type TaskStartRunSummary
} from '../../../../shared/task-board/task-start-run'
import type { TaskProvider } from '../../../../shared/work-items/task-providers'
import { TaskBoard, type TaskBoardColumn, type TaskBoardRunActions } from './TaskBoard'

function makeCard(
  provider: TaskProvider,
  displayId: string,
  title: string,
  extra: Partial<TaskBoardWireCard> = {}
): TaskBoardWireCard {
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
  } as TaskBoardWireCard
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
        updatingRefKeys={new Set()}
        selectedRefKey="linear:fixture:ENG-77"
        formatUpdatedAt={(value) => value}
      />
    </div>
  )
})

function run(
  fields: Pick<TaskStartRunSummary, 'state' | 'phase'> & Partial<TaskStartRunSummary>
): TaskStartRunSummary {
  return {
    id: `run-${fields.state}-${fields.phase}`,
    updatedAt: '4 min ago',
    worktreeId: 'acme::/work/acme-task',
    orchestrator: {
      hostId: 'local',
      agent: 'claude',
      worktreeId: 'acme::/work/acme-task',
      surface: 'terminal',
      paneKey: 'tab-1:leaf-1'
    },
    percent: taskStartPercent(fields.phase, fields.progress),
    ...fields
  }
}

const runActions: TaskBoardRunActions = {
  onStart: () => {},
  onStartAs: () => {},
  onStop: () => {},
  onForget: () => {},
  onOpenRun: () => {},
  pendingRefKeys: new Set(['jira:fixture:APP-7'])
}

const runColumns: TaskBoardColumn[] = [
  {
    id: 'todo',
    label: 'Todo',
    status: { id: 'todo', label: 'Todo' },
    cards: [
      makeCard('jira', 'APP-1', 'Adjust the invoice filter', {
        labels: ['backend'],
        taskStart: null
      }),
      makeCard('jira', 'APP-7', 'Starting request in flight', { taskStart: null }),
      makeCard('gitlab', '#9', 'Run that was stopped', {
        taskStart: run({ state: 'stopped', phase: 'planning' })
      }),
      makeCard('jira', 'APP-8', 'Started, but its move needs a choice', {
        taskStart: run({ state: 'running', phase: 'planning', note: 'move-skipped' })
      })
    ]
  },
  {
    id: 'in-progress',
    label: 'In progress',
    status: { id: 'in-progress', label: 'In progress' },
    cards: [
      makeCard('jira', 'APP-2', 'Migrate the settings schema to the new store', {
        labels: ['backend'],
        taskStart: run({
          state: 'running',
          phase: 'development',
          progress: { current: 3, total: 7, step: 'reviewing' }
        })
      }),
      makeCard('github', '#31', 'Ask before deleting stale branches', {
        taskStart: run({ state: 'waiting', phase: 'plan-review' })
      }),
      makeCard('linear', 'ENG-12', 'Prompt not confirmed yet', {
        taskStart: run({ state: 'running', phase: 'starting', note: 'prompt-unconfirmed' })
      }),
      makeCard('gitlab', '#14', 'Stop the orchestrator', {
        taskStart: run({ state: 'stopping', phase: 'qa' })
      }),
      makeCard('linear', 'ENG-15', 'Stop left unconfirmed', {
        taskStart: run({ state: 'stopping', phase: 'development', failure: 'stop-unconfirmed' })
      })
    ]
  },
  {
    id: 'completed',
    label: 'Done',
    status: { id: 'completed', label: 'Done' },
    cards: [
      makeCard('jira', 'APP-3', 'Orchestrator exited mid-run', {
        taskStart: run({
          state: 'failed',
          phase: 'final-review',
          failure: 'orchestrator-exited'
        })
      }),
      makeCard('github', '#40', 'Add retry to the exporter', {
        taskStart: run({ state: 'completed', phase: 'completed' })
      }),
      makeCard('gitlab', '#52', 'Run forgotten after an unconfirmed stop', {
        taskStart: run({
          state: 'stopped',
          phase: 'development',
          failure: 'stop-unconfirmed',
          note: 'stop-forced'
        })
      })
    ]
  }
]

/** Every task-start state a card shows; the board's columns are its narrow width. */
export const taskStartStates = defineFixture({
  width: 980,
  render: () => (
    <div className="bg-background">
      <TaskBoard
        columns={runColumns}
        canDrop={() => ({ ok: true })}
        onMove={async () => {}}
        onOpen={() => {}}
        runActions={runActions}
        updatingRefKeys={new Set()}
        selectedRefKey={null}
        formatUpdatedAt={(value) => value}
      />
    </div>
  )
})

/** "Start as…" open on a card without a run; focus reveals its hover actions. */
export const startAsMenu = defineFixture({
  width: 980,
  render: () => (
    <div className="bg-background">
      <TaskBoard
        columns={runColumns.slice(0, 1)}
        canDrop={() => ({ ok: true })}
        onMove={async () => {}}
        onOpen={() => {}}
        runActions={runActions}
        updatingRefKeys={new Set()}
        selectedRefKey={null}
        formatUpdatedAt={(value) => value}
      />
    </div>
  ),
  interact: async (frame) => {
    const trigger = frame.querySelector<HTMLButtonElement>(
      'button[aria-label="Start options for APP-1"]'
    )
    trigger?.focus()
    trigger?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
})

/** "Forget run" open on a card whose stop stayed unconfirmed. */
export const forgetRunMenu = defineFixture({
  width: 980,
  render: () => (
    <div className="bg-background">
      <TaskBoard
        columns={runColumns.slice(1, 2)}
        canDrop={() => ({ ok: true })}
        onMove={async () => {}}
        onOpen={() => {}}
        runActions={runActions}
        updatingRefKeys={new Set()}
        selectedRefKey={null}
        formatUpdatedAt={(value) => value}
      />
    </div>
  ),
  interact: async (frame) => {
    // ENG-15 is the column's last card; its stop options are its last menu, in any locale.
    const trigger = [
      ...frame.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')
    ].at(-1)
    trigger?.focus()
    trigger?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
})
