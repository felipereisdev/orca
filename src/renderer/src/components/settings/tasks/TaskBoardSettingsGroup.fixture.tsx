import { defineFixture } from '../../../component-fixtures/component-fixture'
import { getDefaultTaskBoardSettings } from '../../../../../shared/task-board/task-board-settings'
import { TaskBoardSettingsView } from './TaskBoardSettingsGroup'

const statuses = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
]

const settings = getDefaultTaskBoardSettings()
settings.providers.gitlab.rules = [{ match: 'workflow::review', statusId: 'in-review' }]
settings.providers.jira.rules = [{ match: 'In QA', statusId: 'in-review' }]
settings.providers.jira.dropTargets = { 'in-review': 'In QA' }

export const expanded = defineFixture({
  width: 560,
  render: () => (
    <TaskBoardSettingsView settings={settings} statuses={statuses} onChange={() => {}} />
  ),
  interact: (frame) => {
    // Select triggers also carry aria-expanded; only open the provider disclosures.
    for (const button of frame.querySelectorAll<HTMLButtonElement>(
      '[data-settings-group-disclosure] > button'
    )) {
      button.click()
    }
  }
})
