import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import {
  JiraBoardMoveDialog,
  type JiraBoardMovePrompt
} from '@/components/task-page/jira/boards/task-page-jira-board-move-dialog'
import type { JiraTransitionFieldsSubmit } from '@/components/task-page/jira/issue-workspace/jira-transition-fields-form'
import type { TaskBoardChoice } from '../../../../../shared/task-board/task-board-wire-types'
import { TaskBoardChoiceDialog } from './TaskBoardChoiceDialog'

/** Several Linear states map to the drop's column. */
export type TaskBoardStateChoice = {
  displayId: string
  destination: string
  choices: TaskBoardChoice[]
  error: string | null
}

/** The Jira status change and Linear state pickers a board drop opens when the host asks. */
export function TaskBoardMoveDialogs({
  jiraPrompt,
  stateChoice,
  pending,
  onClose,
  onChooseJira,
  onSubmitJira,
  onChooseState
}: {
  jiraPrompt: JiraBoardMovePrompt | null
  stateChoice: TaskBoardStateChoice | null
  pending: boolean
  onClose: () => void
  onChooseJira: (choice: TaskBoardChoice) => void
  onSubmitJira: (submit: JiraTransitionFieldsSubmit) => Promise<void>
  onChooseState: (choiceId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <JiraBoardMoveDialog
        prompt={jiraPrompt}
        pending={pending}
        onClose={onClose}
        onChoose={onChooseJira}
        onSubmit={onSubmitJira}
        // Retry only shows for a prompt without choices, which the board never opens.
        onRetry={onClose}
      />
      <TaskBoardChoiceDialog
        open={stateChoice !== null}
        title={t('taskBoard.chooseStateTitle', 'Move {{id}} to {{column}}', {
          id: stateChoice?.displayId,
          column: stateChoice?.destination
        })}
        description={t(
          'taskBoard.chooseStateDescription',
          'Several Linear states match this column. Choose one:'
        )}
        options={(stateChoice?.choices ?? []).map((choice) => ({
          id: choice.id,
          label: choice.name
        }))}
        pending={pending}
        error={stateChoice?.error ?? null}
        onChoose={onChooseState}
        onClose={onClose}
      />
    </>
  )
}
