import { useMemo, useState } from 'react'
import type { Repo } from '../../../../../shared/repository/repo-types'
import type { LinearProjectSummary } from '../../../../../shared/linear/project-types'
import type { LinearProjectReference } from '../../../../../shared/linear/linear-project-reference'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host/execution-host'
import { taskSourceRuntimeTarget } from '@/lib/work-items/task-source-runtime-target'
import { useAppStore } from '@/store/index'
import {
  useLinearProjectInventory,
  useLinearProjectSearch
} from '../../use-linear-project-inventory'
import {
  WorkItemScopePicker,
  type WorkItemScopeOption,
  type WorkItemScopeSearch
} from '../../task-page/source-selection/work-item-scope-picker'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { SettingsSearchEntry } from '../search/settings-search'
import { searchKeywordTranslator } from '../search/settings-search-keywords'

export function getRepositoryLinearProjectSearchEntry(
  repo: Repo,
  t: Translate
): SettingsSearchEntry {
  const translateSearchKeyword = searchKeywordTranslator(t)
  return {
    title: t('components.RepositoryLinearProjectSection.title', 'Default Linear project'),
    description: t(
      'components.RepositoryLinearProjectSection.description',
      'Linear cards from this project start in this repository.'
    ),
    keywords: [
      repo.displayName,
      ...translateSearchKeyword(
        'components.RepositoryLinearProjectSection.keywordLinear',
        'linear'
      ),
      ...translateSearchKeyword(
        'components.RepositoryJiraProjectSection.keywordDefaultProject',
        'default project'
      ),
      ...translateSearchKeyword(
        'components.RepositoryLinearProjectSection.keywordStartTask',
        'start task'
      )
    ]
  }
}

function projectKey(project: Pick<LinearProjectReference, 'id' | 'workspaceId'>): string {
  return `${project.workspaceId ?? ''}:${project.id}`
}

function RepositoryLinearProjectView({
  repo,
  projects,
  connected,
  loading,
  saving,
  error,
  search,
  onChange,
  forceVisible
}: {
  repo: Repo
  projects: readonly LinearProjectSummary[]
  connected: boolean
  loading: boolean
  saving: boolean
  error: string | null
  search: WorkItemScopeSearch
  onChange: (project: LinearProjectReference | null) => void
  forceVisible?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const label = t('components.RepositoryLinearProjectSection.title', 'Default Linear project')
  const options: WorkItemScopeOption<LinearProjectReference>[] = projects.map((project) => ({
    key: projectKey({ id: project.id, workspaceId: project.workspaceId ?? null }),
    value: { id: project.id, name: project.name, workspaceId: project.workspaceId ?? null },
    label: project.name,
    searchText: `${project.name} ${project.workspaceName ?? ''}`,
    description: project.workspaceName
  }))
  const value = repo.defaultLinearProject ?? null
  return (
    <SearchableSetting
      title={label}
      description={t(
        'components.RepositoryLinearProjectSection.description',
        'Linear cards from this project start in this repository.'
      )}
      keywords={['linear', 'project', repo.displayName]}
      forceVisible={forceVisible}
      className="space-y-2 py-3"
    >
      <p className="text-sm font-semibold">{label}</p>
      <WorkItemScopePicker
        options={options}
        selectedKey={value ? projectKey(value) : null}
        selectedLabel={value?.name}
        onChange={onChange}
        label={label}
        allLabel={t('components.RepositoryLinearProjectSection.none', 'No default project')}
        searchPlaceholder={t(
          'components.RepositoryLinearProjectSection.search',
          'Search Linear projects'
        )}
        emptyLabel={t('components.RepositoryLinearProjectSection.empty', 'No projects found.')}
        disabled={loading || saving}
        search={search}
      />
      {!loading && !connected && !error ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'components.RepositoryLinearProjectSection.connect',
            'Connect Linear in Integrations to choose a project.'
          )}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </SearchableSetting>
  )
}

/** Saves through the repo's own host; the error to show, or null once the host echoes it back. */
async function saveDefaultLinearProject({
  repo,
  hostId,
  project,
  updateRepo,
  t
}: {
  repo: Repo
  hostId: ExecutionHostId
  project: LinearProjectReference | null
  updateRepo: LinearProjectUpdateRepo
  t: Translate
}): Promise<string | null> {
  let result: unknown
  try {
    result = await updateRepo(repo.id, { defaultLinearProject: project })
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught)
  }
  if (result === false) {
    return t(
      'components.RepositoryLinearProjectSection.saveFailed',
      'Could not save the default Linear project.'
    )
  }
  const echoed = useAppStore
    .getState()
    .repos.find(
      (entry) => entry.id === repo.id && getRepoExecutionHostId(entry) === hostId
    )?.defaultLinearProject
  // An older runtime drops the unknown field.
  return (echoed?.id ?? null) === (project?.id ?? null)
    ? null
    : t(
        'components.RepositoryLinearProjectSection.runtimeUpdate',
        'Update this runtime to save a default Linear project.'
      )
}

type LinearProjectUpdateRepo = (
  id: string,
  updates: { defaultLinearProject: LinearProjectReference | null }
) => unknown

export function RepositoryLinearProjectSection({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: LinearProjectUpdateRepo
  forceVisible?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const hostId = getRepoExecutionHostId(repo)
  const source = useMemo(() => taskSourceRuntimeTarget({ hostId }), [hostId])
  const inventory = useLinearProjectInventory(source, true)
  const [query, setQuery] = useState('')
  const found = useLinearProjectSearch(source, query)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const applyProject = (project: LinearProjectReference | null) => {
    setSaving(true)
    setError(null)
    void saveDefaultLinearProject({ repo, hostId, project, updateRepo, t }).then((message) => {
      setError(message)
      setSaving(false)
    })
  }
  return (
    <RepositoryLinearProjectView
      repo={repo}
      projects={found.projects ?? inventory.projects}
      connected={inventory.connected}
      loading={inventory.loading}
      saving={saving}
      error={error ?? found.error ?? inventory.error}
      search={{
        query,
        onQueryChange: setQuery,
        loading: found.loading,
        loadingLabel: t('components.RepositoryLinearProjectSection.searching', 'Searching…')
      }}
      onChange={applyProject}
      forceVisible={forceVisible}
    />
  )
}
