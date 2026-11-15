import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import type { TaskStartAgentCatalogEntry } from '../../../../shared/task-board/task-board-wire-types'
import type {
  TaskStartRole,
  TaskStartRoles
} from '../../../../shared/task-board/task-start-settings'
import { TaskStartRolesEditor } from './TaskStartRolesEditor'

const efforts = [
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' }
]
const catalog: TaskStartAgentCatalogEntry[] = [
  {
    agent: 'claude',
    label: 'Claude',
    models: [{ id: 'sonnet', label: 'Sonnet', efforts }]
  },
  {
    agent: 'claude',
    accountId: 'ucloud',
    label: 'Claude (Ucloud)',
    models: [
      { id: 'opus', label: 'Opus', efforts },
      { id: 'sonnet', label: 'Sonnet', efforts }
    ]
  },
  { agent: 'codex', label: 'Codex', models: [{ id: 'gpt-5', label: 'GPT-5', efforts }] },
  { agent: 'gemini', label: 'Gemini', needsSignIn: true, models: [] }
]
const inherited: Record<TaskStartRole, string> = {
  orchestrator: 'Claude · Opus',
  planner: 'Claude · Opus',
  planReviewer: 'Codex',
  implementer: 'Claude · Sonnet',
  reviewer: 'Codex',
  qa: 'Claude · Sonnet'
}

function Harness({
  initial,
  invalidRoles
}: {
  initial: TaskStartRoles
  invalidRoles?: TaskStartRole[]
}): React.JSX.Element {
  const [roles, setRoles] = useState(initial)
  return (
    <div className="p-4">
      <TaskStartRolesEditor
        catalog={catalog}
        roles={roles}
        inherited={inherited}
        invalidRoles={invalidRoles}
        onChange={setRoles}
      />
    </div>
  )
}

export const allInherited = defineFixture({
  width: 520,
  render: () => <Harness initial={{}} />
})

export const orchestratorOverride = defineFixture({
  width: 520,
  render: () => (
    <Harness
      initial={{
        orchestrator: { agent: 'claude', accountId: 'ucloud', model: 'opus', effort: 'high' }
      }}
    />
  )
})

export const invalidRole = defineFixture({
  width: 360,
  render: () => (
    <Harness
      initial={{
        orchestrator: { agent: 'claude', accountId: 'ucloud', model: 'opus', effort: 'high' },
        reviewer: { agent: 'codex', accountId: 'gone', model: 'gpt-5' }
      }}
      invalidRoles={['reviewer']}
    />
  )
})
