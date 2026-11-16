import { useState } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../../shared/constants'
import type {
  TaskBoardWireCard,
  TaskStartOptionsResult
} from '../../../../../shared/task-board/task-board-wire-types'
import { TaskStartDialogView, type TaskStartDialogEdits } from './TaskStartDialog'
import { TaskBoardStartDialogs } from './TaskBoardStartDialogs'
import type { TaskBoardStart } from './use-task-board-start'

const efforts = [
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' }
]
const options: TaskStartOptionsResult = {
  repoId: 'repo-1',
  repoCandidates: [],
  repos: [
    { id: 'repo-1', label: 'acme-web', kind: 'git' },
    { id: 'repo-2', label: 'acme-api', kind: 'git' },
    { id: 'repo-3', label: 'notes', kind: 'folder' }
  ],
  workspaceMode: 'worktree',
  baseRef: 'origin/develop',
  roles: null,
  labels: {
    orchestrator: 'Claude (Ucloud) · Opus · High',
    planner: 'Claude (Ucloud) · Opus · High',
    planReviewer: 'Codex · GPT-5',
    implementer: 'Claude · Sonnet',
    reviewer: 'Codex · GPT-5',
    qa: 'Claude · Sonnet'
  },
  catalog: [
    { agent: 'claude', label: 'Claude', models: [{ id: 'sonnet', label: 'Sonnet', efforts }] },
    {
      agent: 'claude',
      accountId: 'ucloud',
      label: 'Claude (Ucloud)',
      models: [{ id: 'opus', label: 'Opus', efforts }]
    },
    { agent: 'codex', label: 'Codex', models: [{ id: 'gpt-5', label: 'GPT-5', efforts }] }
  ],
  invalidRoles: []
}

function Harness({
  repoRequired = false,
  error = null
}: {
  repoRequired?: boolean
  error?: string | null
}): React.JSX.Element {
  const [repoId, setRepoId] = useState<string | null>(repoRequired ? null : 'repo-1')
  const [edits, setEdits] = useState<TaskStartDialogEdits>({ roles: {} })
  const [userPrompt, setUserPrompt] = useState('Foque primeiro no endpoint de faturas.')
  return (
    <TaskStartDialogView
      displayId="APP-12"
      options={{ loading: false, data: repoRequired ? { ...options, repoId: null } : options }}
      repoRequired={repoRequired}
      repoId={repoId}
      edits={edits}
      userPrompt={userPrompt}
      pending={false}
      error={error}
      onRepoChange={setRepoId}
      onEditsChange={setEdits}
      onUserPromptChange={setUserPrompt}
      onSubmit={() => {}}
      onClose={() => {}}
    />
  )
}

const setup = (): void => {
  window.api.repos.getBaseRefDefault = () =>
    Promise.resolve({ defaultBaseRef: 'origin/main', remoteCount: 1 })
}

export const resolvedRepo = defineFixture({
  width: 720,
  store: { settings: getDefaultSettings('/home/fixture') },
  setup,
  render: () => <Harness />
})

export const repoRequired = defineFixture({
  width: 720,
  store: { settings: getDefaultSettings('/home/fixture') },
  setup,
  render: () => <Harness repoRequired />
})

export const startError = defineFixture({
  width: 720,
  store: { settings: getDefaultSettings('/home/fixture') },
  setup,
  render: () => <Harness error="Sign in to the orchestrator's account, then start again." />
})

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the confirmations read only the card's display id.
const card = { refKey: 'jira:fixture:APP-12', displayId: 'APP-12' } as TaskBoardWireCard

function start(overrides: Partial<TaskBoardStart>): TaskBoardStart {
  const noop = (): void => {}
  return {
    actions: {
      onStart: noop,
      onStartAs: noop,
      onStop: noop,
      onForget: noop,
      onOpenRun: noop,
      pendingRefKeys: new Set()
    },
    dialog: null,
    primaryConfirm: null,
    stopConfirm: null,
    forgetConfirm: null,
    submitDialog: noop,
    closeDialog: noop,
    confirmPrimary: noop,
    cancelPrimary: noop,
    confirmStop: noop,
    cancelStop: noop,
    confirmForget: noop,
    cancelForget: noop,
    ...overrides
  }
}

export const stopConfirm = defineFixture({
  width: 720,
  render: () => (
    <TaskBoardStartDialogs start={start({ stopConfirm: { card, workers: 3 } })} hostId="local" />
  )
})

export const primaryConfirm = defineFixture({
  width: 720,
  render: () => (
    <TaskBoardStartDialogs
      start={start({
        primaryConfirm: { card, params: {}, reasons: ['uncommitted', 'other-branch'] }
      })}
      hostId="local"
    />
  )
})

export const forgetConfirm = defineFixture({
  width: 720,
  render: () => <TaskBoardStartDialogs start={start({ forgetConfirm: card })} hostId="local" />
})
