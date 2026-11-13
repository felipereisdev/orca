import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import {
  JiraBoardMoveDialog,
  type JiraBoardMovePrompt
} from '@/components/task-page/jira/task-page-jira-board-move-dialog'
import type { JiraIssueUpdate, JiraTransition } from '../../../../../shared/jira/jira-types'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import type { LinearWorkflowState } from '../../../../../shared/linear/workspace-types'
import { TaskBoardChoiceDialog } from './TaskBoardChoiceDialog'

export type TaskBoardLinearChoice = {
  issue: LinearIssue
  destination: string
  states: LinearWorkflowState[]
  error: string | null
}

/** The Jira transition and Linear state pickers a board drop opens when its target is ambiguous. */
export function TaskBoardMoveDialogs({
  jiraPrompt,
  linearChoice,
  pending,
  onClose,
  onChooseJira,
  onSubmitJira,
  onChooseLinear
}: {
  jiraPrompt: JiraBoardMovePrompt | null
  linearChoice: TaskBoardLinearChoice | null
  pending: boolean
  onClose: () => void
  onChooseJira: (transition: JiraTransition) => void
  onSubmitJira: (transition: JiraTransition, updates: JiraIssueUpdate) => Promise<void>
  onChooseLinear: (stateId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <JiraBoardMoveDialog
        prompt={jiraPrompt}
        pending={pending}
        onClose={onClose}
        onChoose={onChooseJira}
        onSubmit={async (updates) => {
          if (jiraPrompt?.selected) {
            await onSubmitJira(jiraPrompt.selected, updates)
          }
        }}
        // Retry only shows for a prompt without transitions, which the board never opens.
        onRetry={onClose}
      />
      <TaskBoardChoiceDialog
        open={linearChoice !== null}
        title={t('taskBoard.chooseStateTitle', 'Move {{id}} to {{column}}', {
          id: linearChoice?.issue.identifier,
          column: linearChoice?.destination
        })}
        description={t(
          'taskBoard.chooseStateDescription',
          'Several Linear states match this column. Choose one:'
        )}
        options={(linearChoice?.states ?? []).map((state) => ({ id: state.id, label: state.name }))}
        pending={pending}
        error={linearChoice?.error ?? null}
        onChoose={onChooseLinear}
        onClose={onClose}
      />
    </>
  )
}
