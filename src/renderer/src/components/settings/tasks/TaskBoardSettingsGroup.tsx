import type React from 'react'
import { useMemo } from 'react'
import {
  getDefaultTaskBoardSettings,
  normalizeTaskBoardSettings,
  type TaskBoardSettings
} from '../../../../../shared/task-board/task-board-settings'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { TaskBoardProviderRules } from './TaskBoardProviderRules'
import { getTaskBoardSettingsSearchKeywords } from './tasks-search'

const PROVIDER_ORDER: TaskProvider[] = ['jira', 'linear', 'gitlab', 'github']

type TaskBoardSettingsViewProps = {
  settings: TaskBoardSettings
  statuses: WorkspaceStatusDefinition[]
  onChange: (next: TaskBoardSettings) => void
}

export function TaskBoardSettingsView({
  settings,
  statuses,
  onChange
}: TaskBoardSettingsViewProps): React.JSX.Element {
  const t = useTranslate()
  const providerLabels: Record<TaskProvider, string> = {
    jira: t('taskBoard.settings.providerJira', 'Jira'),
    linear: t('taskBoard.settings.providerLinear', 'Linear'),
    gitlab: t('taskBoard.settings.providerGitLab', 'GitLab'),
    github: t('taskBoard.settings.providerGitHub', 'GitHub')
  }
  const doneColumn = t('taskBoard.settings.doneColumn', 'Done column')

  return (
    <SettingsGroup
      title={t('taskBoard.settings.title', 'Task board')}
      description={t(
        'taskBoard.settings.description',
        'Choose which board column each issue status or label lands in.'
      )}
    >
      <SearchableSetting
        title={t('taskBoard.settings.title', 'Task board')}
        description={t(
          'taskBoard.settings.searchDescription',
          'Board columns and status mapping for issues across providers.'
        )}
        keywords={getTaskBoardSettingsSearchKeywords()}
      >
        <SettingsRow
          label={doneColumn}
          control={
            <Select
              value={settings.doneStatusId}
              onValueChange={(doneStatusId) => onChange({ ...settings, doneStatusId })}
            >
              <SelectTrigger className="w-40" aria-label={doneColumn}>
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
          }
        />
        {PROVIDER_ORDER.map((provider) => (
          <TaskBoardProviderRules
            key={provider}
            provider={provider}
            label={providerLabels[provider]}
            value={settings.providers[provider]}
            statuses={statuses}
            onChange={(next) =>
              onChange({ ...settings, providers: { ...settings.providers, [provider]: next } })
            }
          />
        ))}
        <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
          {t(
            'taskBoard.settings.help',
            'Columns are your workspace statuses; edit them from the workspace board.'
          )}
        </p>
      </SearchableSetting>
    </SettingsGroup>
  )
}

export function TaskBoardSettingsGroup(): React.JSX.Element {
  const saved = useAppStore((s) => s.settings?.taskBoard)
  const statuses = useAppStore((s) => s.workspaceStatuses)
  const updateSettings = useAppStore((s) => s.updateSettings)
  // Why: a fallback built inside the selector would be a new object every render.
  const settings = useMemo(() => saved ?? getDefaultTaskBoardSettings(), [saved])

  return (
    <TaskBoardSettingsView
      settings={settings}
      statuses={statuses}
      onChange={(next) => void updateSettings({ taskBoard: normalizeTaskBoardSettings(next) })}
    />
  )
}
