import type React from 'react'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../../shared/execution-host'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import {
  getDefaultGlobalTaskStartSettings,
  resolveTaskStartRoles,
  resolveTaskStartWorkspaceMode,
  type GlobalTaskStartSettings,
  type RepoTaskStartSettings,
  type TaskStartRole,
  type TaskStartRoles,
  type TaskStartWorkspaceMode
} from '../../../../../shared/task-board/task-start-settings'
import type { TaskStartAgentCatalogEntry } from '../../../../../shared/task-board/task-board-wire-types'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { BaseRefPicker } from '../../source-control/BaseRefPicker'
import { Label } from '../../ui/label'
import { mapTaskStartRoles, taskStartChoiceLabel } from '../../task-start/task-start-choice-label'
import { TaskStartRolesEditor } from '../../task-start/TaskStartRolesEditor'
import { useTaskStartOptions } from '../../task-start/use-task-start-options'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { matchesSettingsSearch } from '../search/settings-search'
import { searchKeywordTranslator } from '../search/settings-search-keywords'

export type RepositoryTaskStartUpdate = Pick<Repo, 'worktreeBaseRef'> & {
  taskStart?: RepoTaskStartSettings | null
}

export function getRepositoryTaskStartSearchEntry(t: Translate = translate) {
  const keyword = searchKeywordTranslator(t)
  return {
    title: t('taskStart.repository.title', 'Start task'),
    description: t(
      'taskStart.repository.searchDescription',
      'Workspace mode, base branch and agents used when a task starts in this project.'
    ),
    keywords: [
      ...keyword('taskStart.repository.search.start', 'start task'),
      ...keyword('taskStart.repository.search.mode', 'workspace mode'),
      ...keyword('taskStart.repository.search.worktree', 'worktree'),
      ...keyword('taskStart.repository.search.base', 'base branch'),
      ...keyword('taskStart.repository.search.agent', 'agent model effort roles')
    ]
  }
}

function nextTaskStart(
  current: RepoTaskStartSettings | undefined,
  patch: RepoTaskStartSettings
): RepoTaskStartSettings | null {
  const { workspaceMode, roles } = { ...current, ...patch }
  const next: RepoTaskStartSettings = {}
  if (workspaceMode) {
    next.workspaceMode = workspaceMode
  }
  if (roles && Object.keys(roles).length > 0) {
    next.roles = roles
  }
  return Object.keys(next).length > 0 ? next : null
}

type RepositoryTaskStartViewProps = {
  repo: Repo
  catalog: TaskStartAgentCatalogEntry[]
  inherited: Record<TaskStartRole, string>
  invalidRoles?: TaskStartRole[]
  loading?: boolean
  error?: string
  updateRepo: (
    repoId: string,
    updates: Partial<RepositoryTaskStartUpdate>
  ) => void | Promise<boolean>
  forceVisible?: boolean
}

export function RepositoryTaskStartView({
  repo,
  catalog,
  inherited,
  invalidRoles,
  loading,
  error,
  updateRepo,
  forceVisible = false
}: RepositoryTaskStartViewProps): React.JSX.Element {
  const t = useTranslate()
  const entry = getRepositoryTaskStartSearchEntry(t)
  const modeLabel = t('taskStart.repository.mode', 'Workspace mode')
  const baseLabel = t('taskStart.repository.baseBranch', 'Base branch for new worktrees')
  const agentsLabel = t('taskStart.repository.agents', 'Agents')
  const isFolder = isFolderRepo(repo)
  const mode = resolveTaskStartWorkspaceMode(repo)
  const setTaskStart = (patch: RepoTaskStartSettings): void => {
    void updateRepo(repo.id, { taskStart: nextTaskStart(repo.taskStart, patch) })
  }

  return (
    <SettingsGroup
      title={entry.title}
      description={t(
        'taskStart.repository.description',
        'How tasks start in this project, and which agents run each role. Roles left on inherit use the global defaults.'
      )}
    >
      <SearchableSetting
        title={entry.title}
        description={entry.description}
        keywords={[repo.displayName, ...entry.keywords]}
        className="space-y-4 py-3"
        forceVisible={forceVisible}
      >
        {isFolder ? null : (
          <div className="space-y-2">
            <Label variant="settings">{modeLabel}</Label>
            <SettingsSegmentedControl<TaskStartWorkspaceMode>
              value={mode}
              onChange={(workspaceMode) => {
                if (workspaceMode !== mode) {
                  setTaskStart({ workspaceMode })
                }
              }}
              ariaLabel={modeLabel}
              size="sm"
              options={[
                {
                  value: 'worktree',
                  label: t('taskStart.repository.modeWorktree', 'New worktree')
                },
                { value: 'primary', label: t('taskStart.repository.modePrimary', 'Primary branch') }
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {mode === 'worktree'
                ? t(
                    'taskStart.repository.modeWorktreeHint',
                    'Every start creates a new worktree from the base branch.'
                  )
                : t(
                    'taskStart.repository.modePrimaryHint',
                    'Agents work in the primary checkout. You confirm first if it has changes or another task is running.'
                  )}
            </p>
          </div>
        )}
        {isFolder ? null : (
          <div className="space-y-2">
            <Label variant="settings">{baseLabel}</Label>
            <div
              inert={mode === 'primary'}
              className={mode === 'primary' ? 'opacity-50' : undefined}
            >
              <BaseRefPicker
                repoId={repo.id}
                hostId={getRepoExecutionHostId(repo)}
                currentBaseRef={repo.worktreeBaseRef}
                onSelect={(ref) => updateRepo(repo.id, { worktreeBaseRef: ref })}
                onUsePrimary={() => updateRepo(repo.id, { worktreeBaseRef: undefined })}
              />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label variant="settings">{agentsLabel}</Label>
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
              roles={repo.taskStart?.roles ?? {}}
              inherited={inherited}
              invalidRoles={invalidRoles}
              onChange={(roles: TaskStartRoles) => setTaskStart({ roles })}
            />
          )}
        </div>
      </SearchableSetting>
    </SettingsGroup>
  )
}

/** Label each role shows for "inherit": what the real resolver picks when only that role's own repo choice is removed. */
export function repoInheritedLabels(args: {
  global: GlobalTaskStartSettings
  repoTaskStart: RepoTaskStartSettings | undefined
  defaultAgent: TuiAgent | 'blank' | null
  catalog: TaskStartAgentCatalogEntry[]
  fallback: string
}): Record<TaskStartRole, string> {
  const { global, repoTaskStart, defaultAgent, catalog, fallback } = args
  return mapTaskStartRoles((role) => {
    const { [role]: _own, ...roles } = repoTaskStart?.roles ?? {}
    const resolved = resolveTaskStartRoles({
      global,
      repo: { ...repoTaskStart, roles },
      defaultAgent
    })
    return resolved ? taskStartChoiceLabel(resolved[role], catalog) : fallback
  })
}

export function RepositoryTaskStartSection({
  repo,
  updateRepo,
  forceVisible = false
}: {
  repo: Repo
  updateRepo: RepositoryTaskStartViewProps['updateRepo']
  forceVisible?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  if (
    !forceVisible &&
    !matchesSettingsSearch(searchQuery, [getRepositoryTaskStartSearchEntry(t)])
  ) {
    return null
  }
  return (
    <ConnectedRepositoryTaskStart repo={repo} updateRepo={updateRepo} forceVisible={forceVisible} />
  )
}

// Why: split from the visibility check so a search-filtered section does not fetch options.
function ConnectedRepositoryTaskStart({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: RepositoryTaskStartViewProps['updateRepo']
  forceVisible: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const hostId = getRepoExecutionHostId(repo)
  // Why: the repo's own host serves its catalog and runs the start, as for the pane's other RPCs.
  const options = useTaskStartOptions({ repoId: repo.id }, hostId)
  const global = useAppStore((s) => s.settings?.taskStart) ?? getDefaultGlobalTaskStartSettings()
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent ?? null)
  const catalog = options.data?.catalog ?? []
  const labels = repoInheritedLabels({
    global,
    repoTaskStart: repo.taskStart,
    defaultAgent,
    catalog,
    fallback: t('taskStart.repository.noDefault', 'No default agent')
  })
  // Why: a remote host resolves with its own global settings, which this machine cannot see.
  const globalLabel = t('taskStart.repository.inheritGlobal', 'global')
  const inherited =
    hostId === LOCAL_EXECUTION_HOST_ID ? labels : mapTaskStartRoles(() => globalLabel)
  return (
    <RepositoryTaskStartView
      repo={repo}
      catalog={catalog}
      inherited={inherited}
      invalidRoles={options.data?.invalidRoles}
      loading={options.loading}
      error={options.error}
      updateRepo={updateRepo}
      forceVisible={forceVisible}
    />
  )
}
