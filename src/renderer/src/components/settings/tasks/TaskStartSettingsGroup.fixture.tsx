import { useState } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { TaskStartAgentCatalogEntry } from '../../../../../shared/task-board/task-board-wire-types'
import type { GlobalTaskStartSettings } from '../../../../../shared/task-board/task-start-settings'
import { TaskStartSettingsView } from './TaskStartSettingsGroup'

const efforts = [
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' }
]
const catalog: TaskStartAgentCatalogEntry[] = [
  { agent: 'claude', label: 'Claude', models: [{ id: 'sonnet', label: 'Sonnet', efforts }] },
  {
    agent: 'claude',
    accountId: 'ucloud',
    label: 'Claude (Ucloud)',
    models: [{ id: 'opus', label: 'Opus', efforts }]
  },
  { agent: 'codex', label: 'Codex', models: [{ id: 'gpt-5', label: 'GPT-5', efforts }] }
]

function Harness({ initial }: { initial: GlobalTaskStartSettings }): React.JSX.Element {
  const [settings, setSettings] = useState(initial)
  return (
    <TaskStartSettingsView
      settings={settings}
      catalog={catalog}
      defaultAgentLabel="Claude"
      onChange={setSettings}
    />
  )
}

export const defaults = defineFixture({
  width: 640,
  render: () => <Harness initial={{ roles: {} }} />
})

export const configured = defineFixture({
  width: 640,
  render: () => (
    <Harness
      initial={{
        roles: {
          orchestrator: { agent: 'claude', accountId: 'ucloud', model: 'opus', effort: 'high' },
          reviewer: { agent: 'codex', model: 'gpt-5' }
        }
      }}
    />
  )
})
