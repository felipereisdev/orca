import type React from 'react'
import { useMemo } from 'react'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host/execution-host'
import {
  getDefaultGlobalTaskStartSettings,
  normalizeGlobalTaskStartSettings,
  type GlobalTaskStartSettings,
  type TaskStartAgentChoice
} from '../../../../../shared/task-board/task-start-settings'
import type { TaskStartAgentCatalogEntry } from '../../../../../shared/task-board/task-board-wire-types'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { mapTaskStartRoles, taskStartChoiceLabel } from '../../task-start/task-start-choice-label'
import { TaskStartRolesEditor } from '../../task-start/TaskStartRolesEditor'
import { useTaskStartOptions } from '../../task-start/use-task-start-options'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { getTaskStartSettingsSearchKeywords } from './tasks-search'

type TaskStartSettingsViewProps = {
  settings: GlobalTaskStartSettings
  catalog: TaskStartAgentCatalogEntry[]
  defaultAgentLabel: string
  loading?: boolean
  error?: string
  onChange: (next: GlobalTaskStartSettings) => void
}

export function TaskStartSettingsView({
  settings,
  catalog,
  defaultAgentLabel,
  loading,
  error,
  onChange
}: TaskStartSettingsViewProps): React.JSX.Element {
  const t = useTranslate()
  const title = t('taskStart.settings.title', 'Start task')
  const { orchestrator } = settings.roles
  // Why: roles without a choice fall back to the orchestrator, which falls back to the default agent.
  const fallbackLabel = orchestrator
    ? taskStartChoiceLabel(orchestrator, catalog)
    : defaultAgentLabel
  const inherited = mapTaskStartRoles(() => fallbackLabel)

  return (
    <SettingsGroup
      title={title}
      description={t(
        'taskStart.settings.description',
        'Default agent, model and effort for each role when you start a task from the board. Projects can override them.'
      )}
    >
      <SearchableSetting
        title={title}
        description={t(
          'taskStart.settings.searchDescription',
          'Default agents, models and effort for the roles that run a task from the board.'
        )}
        keywords={getTaskStartSettingsSearchKeywords()}
        className="space-y-3 py-3"
      >
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="text-xs text-muted-foreground">
            {t('taskStart.settings.loading', 'Loading agents…')}
          </p>
        ) : (
          <TaskStartRolesEditor
            catalog={catalog}
            roles={settings.roles}
            inherited={inherited}
            onChange={(roles) => onChange({ ...settings, roles })}
          />
        )}
      </SearchableSetting>
    </SettingsGroup>
  )
}

export function TaskStartSettingsGroup(): React.JSX.Element {
  const saved = useAppStore((s) => s.settings?.taskStart)
  const defaultTuiAgent = useAppStore((s) => s.settings?.defaultTuiAgent ?? null)
  const updateSettings = useAppStore((s) => s.updateSettings)
  // Why: Settings edits this machine's global settings, so its catalog is the local host's.
  const options = useTaskStartOptions({}, LOCAL_EXECUTION_HOST_ID)
  const settings = useMemo(() => saved ?? getDefaultGlobalTaskStartSettings(), [saved])
  const catalog = options.data?.catalog ?? []
  const t = useTranslate()
  const defaultChoice: TaskStartAgentChoice | null =
    defaultTuiAgent && defaultTuiAgent !== 'blank' ? { agent: defaultTuiAgent } : null
  const defaultAgentLabel = defaultChoice
    ? taskStartChoiceLabel(defaultChoice, catalog)
    : t('taskStart.settings.noDefaultAgent', 'No default agent')

  return (
    <TaskStartSettingsView
      settings={settings}
      catalog={catalog}
      defaultAgentLabel={defaultAgentLabel}
      loading={options.loading}
      error={options.error}
      onChange={(next) =>
        void updateSettings({ taskStart: normalizeGlobalTaskStartSettings(next) })
      }
    />
  )
}
