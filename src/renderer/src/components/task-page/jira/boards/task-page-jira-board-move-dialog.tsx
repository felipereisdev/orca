import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import {
  JiraTransitionFieldsForm,
  type JiraTransitionFieldsSubmit
} from '../../../jira-transition-fields-form'
import type { TaskBoardChoice } from '../../../../../../shared/task-board/task-board-wire-types'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'

/** A board drop's status change, in the host's choice terms so My board and the Jira tab share it. */
export type JiraBoardMovePrompt = {
  issueKey: string
  issueUrl: string
  destination: string
  choices: TaskBoardChoice[]
  selected: TaskBoardChoice | null
  error: string | null
  loading: boolean
}

type Props = {
  prompt: JiraBoardMovePrompt | null
  pending: boolean
  onClose: () => void
  onChoose: (choice: TaskBoardChoice) => void
  onSubmit: (submit: JiraTransitionFieldsSubmit) => Promise<void>
  onRetry: () => void
}

export function JiraBoardMoveDialog({
  prompt,
  pending,
  onClose,
  onChoose,
  onSubmit,
  onRetry
}: Props): React.JSX.Element {
  const t = useTranslate()
  const fields = prompt?.selected?.fields
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('jira.board.moveTitle', 'Move {{key}} to {{column}}', {
              key: prompt?.issueKey,
              column: prompt?.destination
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'jira.board.moveDescription',
              'Jira controls which status changes are available and which fields they require.'
            )}
          </DialogDescription>
        </DialogHeader>
        {prompt?.loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('jira.transitions.loading', 'Loading status changes…')}
          </p>
        ) : null}
        {prompt?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {prompt.error}
          </p>
        ) : null}
        {!prompt?.selected && !prompt?.loading && prompt?.choices.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t('jira.board.chooseTransition', 'Choose a status change:')}</p>
            {prompt.choices.map((choice) => (
              <Button
                key={choice.id}
                variant="secondary"
                disabled={pending}
                onClick={() => onChoose(choice)}
              >
                {choice.name}
              </Button>
            ))}
          </div>
        ) : null}
        {fields === 'unsupported' ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'jira.transitions.unsupported',
              'Jira requires fields Orca cannot collect yet: {{fields}}.',
              { fields: prompt?.selected?.unsupportedFieldNames?.join(', ') ?? '' }
            )}
          </p>
        ) : null}
        {fields && fields !== 'unsupported' && prompt?.selected ? (
          <JiraTransitionFieldsForm
            key={prompt.selected.id}
            choice={prompt.selected}
            pending={pending}
            onBack={onClose}
            onSubmit={onSubmit}
          />
        ) : null}
        {prompt && (prompt.error || fields === 'unsupported') ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={onClose}>
              {t('jira.board.cancel', 'Cancel')}
            </Button>
            {prompt.selected && fields === null ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  if (prompt?.selected) {
                    onChoose(prompt.selected)
                  }
                }}
              >
                {t('jira.transitions.retry', 'Retry')}
              </Button>
            ) : !prompt.selected && prompt.choices.length === 0 ? (
              <Button variant="secondary" disabled={pending || prompt.loading} onClick={onRetry}>
                {t('jira.transitions.retry', 'Retry')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={(event) => {
                if (prompt) {
                  openAppHttpLink(prompt.issueUrl, { event })
                }
              }}
            >
              <ExternalLink />
              {t('auto.components.JiraIssueWorkspace.69da9a208c', 'Open in Jira')}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
