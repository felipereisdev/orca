import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import { getCommentBodySubmitState } from '@/lib/source-control/review/comments/comment-body-submit-state'
import type {
  TaskBoardChoice,
  TaskBoardMoveFields
} from '../../../shared/task-board/task-board-wire-types'

export type JiraTransitionFieldsSubmit = { choiceId: string; fields: TaskBoardMoveFields }

type Props = {
  choice: TaskBoardChoice
  pending: boolean
  onBack: () => void
  onSubmit: (submit: JiraTransitionFieldsSubmit) => Promise<void>
}

/** The Resolution/Comment form of a Jira status change; renders nothing for other choices. */
export function JiraTransitionFieldsForm({
  choice,
  pending,
  onBack,
  onSubmit
}: Props): React.JSX.Element | null {
  const t = useTranslate()
  const [resolutionId, setResolutionId] = useState('')
  const [comment, setComment] = useState('')
  const fields = choice.fields
  if (fields === null || fields === 'unsupported') {
    return null
  }
  const { resolution, commentRequired } = fields
  const resolutionReady = resolutionId !== '' || !resolution
  const commentState = getCommentBodySubmitState(comment)
  const canSubmit = resolutionReady && (!commentRequired || commentState.status === 'ready')

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending || !canSubmit) {
      return
    }
    const filled: TaskBoardMoveFields = {}
    if (resolution && resolutionId) {
      filled.resolutionId = resolutionId
    }
    if (commentRequired && commentState.status === 'ready') {
      filled.comment = commentState.body
    }
    await onSubmit({ choiceId: choice.id, fields: filled })
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm font-medium">{choice.name}</p>
      {resolution ? (
        <div className="space-y-2">
          <Label htmlFor="jira-transition-resolution">{resolution.name}</Label>
          <Select value={resolutionId} onValueChange={setResolutionId} disabled={pending}>
            <SelectTrigger id="jira-transition-resolution" className="w-full" autoFocus>
              <SelectValue
                placeholder={t('jira.transitions.chooseResolution', 'Choose a resolution')}
              />
            </SelectTrigger>
            <SelectContent>
              {resolution.options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {commentRequired ? (
        <div className="space-y-2">
          <Label htmlFor="jira-transition-comment">
            {t('jira.transitions.comment', 'Comment')}
          </Label>
          <Textarea
            id="jira-transition-comment"
            autoFocus={!resolution}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            required
            disabled={pending}
            rows={3}
          />
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>
          {t('jira.transitions.back', 'Back')}
        </Button>
        <Button type="submit" size="sm" disabled={pending || !canSubmit}>
          {t('jira.transitions.apply', 'Change status')}
        </Button>
      </div>
    </form>
  )
}
