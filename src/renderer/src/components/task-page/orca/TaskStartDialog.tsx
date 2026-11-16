import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { BaseRefPicker } from '@/components/source-control/BaseRefPicker'
import { TaskStartRolesEditor } from '@/components/task-start/TaskStartRolesEditor'
import { useTaskStartOptions } from '@/components/task-start/use-task-start-options'
import { useTranslate } from '@/i18n/use-translate'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskStartOptionsResult } from '../../../../../shared/task-board/task-board-wire-types'
import type {
  TaskStartRoles,
  TaskStartWorkspaceMode
} from '../../../../../shared/task-board/task-start-settings'
import type { TaskStartParams } from '@/runtime/task-board/runtime-task-board-client'
import type { TaskStartDialogState } from './use-task-board-start'

/** This start's choices on top of the repository's configuration; none of them is saved. */
export type TaskStartDialogEdits = {
  mode?: TaskStartWorkspaceMode
  baseRef?: string
  roles: TaskStartRoles
}

export type TaskStartDialogViewProps = {
  displayId: string
  options: { data?: TaskStartOptionsResult; loading: boolean; error?: string }
  /** The host could not resolve the card's repository: the user must pick one. */
  repoRequired: boolean
  repoId: string | null
  /** Where base branches are read; undefined resolves from the repo row. */
  baseRefHostId?: ExecutionHostId
  edits: TaskStartDialogEdits
  /** Extra instructions for the orchestrator, kept when the repository changes. */
  userPrompt: string
  pending: boolean
  error: string | null
  onRepoChange: (repoId: string) => void
  onEditsChange: (edits: TaskStartDialogEdits) => void
  onUserPromptChange: (userPrompt: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function TaskStartDialogView(props: TaskStartDialogViewProps): React.JSX.Element {
  const t = useTranslate()
  const { options, edits, repoId } = props
  const data = options.data
  const repo = data?.repos.find((entry) => entry.id === repoId)
  const isFolder = repo?.kind === 'folder'
  const mode = edits.mode ?? data?.workspaceMode ?? 'worktree'
  const missingRepo = props.repoRequired && !repoId
  const canSubmit = Boolean(repoId) && Boolean(data) && !options.loading && !props.pending
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent scrollable>
        <DialogHeader>
          <DialogTitle>
            {t('taskStart.dialog.title', 'Start {{id}} as…', { id: props.displayId })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'taskStart.dialog.description',
              'Choices here apply to this start only; saved settings stay as they are.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-start-repo">
              {t('taskStart.dialog.repository', 'Repository')}
            </Label>
            <Select value={repoId ?? undefined} onValueChange={props.onRepoChange}>
              <SelectTrigger
                id="task-start-repo"
                size="sm"
                className="w-full"
                aria-invalid={missingRepo ? true : undefined}
              >
                <SelectValue
                  placeholder={t('taskStart.dialog.chooseRepository', 'Choose a repository')}
                />
              </SelectTrigger>
              <SelectContent>
                {(data?.repos ?? []).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {missingRepo ? (
              <p className="text-xs text-destructive">
                {t(
                  'taskStart.dialog.repositoryRequired',
                  'Orca could not tell which repository this issue belongs to. Choose one.'
                )}
              </p>
            ) : null}
          </div>
          {repoId && data && !isFolder ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t('taskStart.repository.mode', 'Workspace mode')}</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={mode}
                onValueChange={(value) => {
                  if (value === 'worktree' || value === 'primary') {
                    props.onEditsChange({ ...edits, mode: value })
                  }
                }}
              >
                <ToggleGroupItem value="worktree">
                  {t('taskStart.repository.modeWorktree', 'New worktree')}
                </ToggleGroupItem>
                <ToggleGroupItem value="primary">
                  {t('taskStart.repository.modePrimary', 'Primary branch')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          ) : null}
          {repoId && data && !isFolder ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t('taskStart.dialog.baseBranch', 'Base branch')}</Label>
              <BaseRefPicker
                repoId={repoId}
                hostId={props.baseRefHostId}
                currentBaseRef={edits.baseRef ?? data.baseRef ?? undefined}
                currentBaseRefLabel={
                  edits.baseRef
                    ? t('taskStart.dialog.baseBranchThisStart', 'For this start only')
                    : t('taskStart.dialog.baseBranchRepository', 'Default for this repository')
                }
                fullWidth
                onSelect={(baseRef) => props.onEditsChange({ ...edits, baseRef })}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label>{t('taskStart.repository.agents', 'Agents')}</Label>
            {options.error ? (
              <p role="alert" className="text-xs text-destructive">
                {options.error}
              </p>
            ) : options.loading || !data ? (
              <p className="text-xs text-muted-foreground">
                {t('taskStart.settings.loading', 'Loading agents…')}
              </p>
            ) : (
              <TaskStartRolesEditor
                catalog={data.catalog}
                roles={edits.roles}
                inherited={data.labels ?? undefined}
                invalidRoles={data.invalidRoles}
                onChange={(roles) => props.onEditsChange({ ...edits, roles })}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-start-user-prompt">
              {t('taskStart.dialog.userPrompt', 'Additional instructions')}
            </Label>
            <Textarea
              id="task-start-user-prompt"
              value={props.userPrompt}
              maxLength={8000}
              rows={3}
              placeholder={t(
                'taskStart.dialog.userPromptPlaceholder',
                'Optional. Sent to the orchestrator with the card and the flow.'
              )}
              onChange={(event) => props.onUserPromptChange(event.target.value)}
            />
          </div>
          {props.error ? (
            <p role="alert" className="text-xs text-destructive">
              {props.error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={props.onClose} disabled={props.pending}>
            {t('taskStart.dialog.cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={props.onSubmit} disabled={!canSubmit}>
            {props.pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {props.pending
              ? t('taskStart.dialog.starting', 'Starting…')
              : t('taskStart.dialog.start', 'Start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TaskStartDialogBody({
  state,
  hostId,
  onSubmit,
  onClose
}: {
  state: TaskStartDialogState
  hostId: ExecutionHostId
  onSubmit: (params: Omit<TaskStartParams, 'ref' | 'confirmPrimary'>) => void
  onClose: () => void
}): React.JSX.Element {
  // The user's repository; until they pick one, the host resolves it from the card.
  const [chosenRepoId, setChosenRepoId] = useState<string | undefined>(undefined)
  const [edits, setEdits] = useState<TaskStartDialogEdits>({ roles: {} })
  const [userPrompt, setUserPrompt] = useState('')
  const options = useTaskStartOptions({ ref: state.card.ref, repoId: chosenRepoId }, hostId)
  const repoId = chosenRepoId ?? options.data?.repoId ?? null
  const runtimeHost = parseExecutionHostId(hostId)?.kind === 'runtime' ? hostId : undefined
  return (
    <TaskStartDialogView
      displayId={state.card.displayId}
      options={options}
      repoRequired={state.repoRequired}
      repoId={repoId}
      baseRefHostId={runtimeHost}
      edits={edits}
      userPrompt={userPrompt}
      pending={state.pending}
      error={state.error}
      onRepoChange={(next) => {
        // Another repository has its own mode, base branch and roles.
        setChosenRepoId(next)
        setEdits({ roles: {} })
      }}
      onEditsChange={setEdits}
      onUserPromptChange={setUserPrompt}
      onSubmit={() => {
        if (!repoId) {
          return
        }
        onSubmit({
          repoId,
          ...(edits.mode ? { workspaceMode: edits.mode } : {}),
          ...(edits.baseRef ? { baseRef: edits.baseRef } : {}),
          ...(Object.keys(edits.roles).length > 0 ? { roles: edits.roles } : {}),
          ...(userPrompt.trim() ? { userPrompt: userPrompt.trim() } : {})
        })
      }}
      onClose={onClose}
    />
  )
}

/** "Start as…": repository, mode, base branch and agents for one start of the card. */
export function TaskStartDialog({
  state,
  hostId,
  onSubmit,
  onClose
}: {
  state: TaskStartDialogState | null
  hostId: ExecutionHostId
  onSubmit: (params: Omit<TaskStartParams, 'ref' | 'confirmPrimary'>) => void
  onClose: () => void
}): React.JSX.Element | null {
  if (!state) {
    return null
  }
  return (
    <TaskStartDialogBody
      key={state.card.refKey}
      state={state}
      hostId={hostId}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
