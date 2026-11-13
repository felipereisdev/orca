import type React from 'react'
import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type {
  TaskBoardProviderSettings,
  TaskBoardRule
} from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsGroupDisclosure } from '../section-layout/SettingsGroupDisclosure'

type RuleRow = TaskBoardRule & { key: number }

type TaskBoardProviderRulesProps = {
  provider: TaskProvider
  label: string
  value: TaskBoardProviderSettings
  statuses: WorkspaceStatusDefinition[]
  onChange: (next: TaskBoardProviderSettings) => void
}

// Commits on blur so a half-typed status name never reaches settings; keyed on the saved text so external changes reset it.
function BlurCommitInput({
  value,
  onCommit,
  ...inputProps
}: {
  value: string
  onCommit: (text: string) => void
} & Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'defaultValue' | 'onChange'
>): React.JSX.Element {
  return (
    <Input
      {...inputProps}
      key={value}
      defaultValue={value}
      onBlur={(event) => {
        if (event.currentTarget.value !== value) {
          onCommit(event.currentTarget.value)
        }
      }}
    />
  )
}

export function TaskBoardProviderRules({
  provider,
  label,
  value,
  statuses,
  onChange
}: TaskBoardProviderRulesProps): React.JSX.Element {
  const t = useTranslate()
  const nextKey = useRef(value.rules.length)
  // Why: normalization drops rules with an empty match, so rows being typed live here until they are valid.
  const [rows, setRows] = useState<RuleRow[]>(() =>
    value.rules.map((rule, index) => ({ ...rule, key: index }))
  )
  const supportsDropTargets = provider === 'jira' || provider === 'linear'
  const matchPlaceholder = supportsDropTargets
    ? t('taskBoard.settings.statusNamePlaceholder', 'Status name')
    : t('taskBoard.settings.labelPlaceholder', 'Label')
  const dropTargetTitle = t('taskBoard.settings.dropTargetTitle', 'Status to apply on drop')

  const commitRows = (nextRows: RuleRow[]): void => {
    setRows(nextRows)
    onChange({
      ...value,
      rules: nextRows.map(({ match, statusId }) => ({ match, statusId }))
    })
  }
  const updateRow = (key: number, patch: Partial<TaskBoardRule>): void =>
    commitRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  return (
    <SettingsGroupDisclosure label={label}>
      <div className="space-y-2 pb-3">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <BlurCommitInput
              value={row.match}
              placeholder={matchPlaceholder}
              aria-label={matchPlaceholder}
              className="min-w-0 flex-1"
              onCommit={(match) => updateRow(row.key, { match })}
            />
            <Select
              value={row.statusId}
              onValueChange={(statusId) => updateRow(row.key, { statusId })}
            >
              <SelectTrigger
                className="w-40"
                aria-label={t('taskBoard.settings.columnLabel', 'Column')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('taskBoard.settings.removeRule', 'Remove rule')}
              onClick={() => commitRows(rows.filter((entry) => entry.key !== row.key))}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={statuses.length === 0}
          onClick={() => {
            const key = nextKey.current
            nextKey.current += 1
            commitRows([...rows, { key, match: '', statusId: statuses[0].id }])
          }}
        >
          <Plus className="size-3.5" />
          {t('taskBoard.settings.addRule', 'Add rule')}
        </Button>
        {supportsDropTargets ? (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-muted-foreground">{dropTargetTitle}</p>
            {statuses.map((status) => (
              <div key={status.id} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-xs">{status.label}</span>
                <BlurCommitInput
                  value={value.dropTargets[status.id] ?? ''}
                  placeholder={t('taskBoard.settings.dropTargetPlaceholder', 'Automatic')}
                  aria-label={`${dropTargetTitle}: ${status.label}`}
                  className="min-w-0 flex-1"
                  onCommit={(name) =>
                    onChange({ ...value, dropTargets: { ...value.dropTargets, [status.id]: name } })
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SettingsGroupDisclosure>
  )
}
