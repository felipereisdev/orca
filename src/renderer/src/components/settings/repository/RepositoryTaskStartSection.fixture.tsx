import { getDefaultSettings } from '../../../../../shared/orca-profiles/constants'
import type { Repo } from '../../../../../shared/repository/repo-types'
import type { TaskStartAgentCatalogEntry } from '../../../../../shared/task-board/task-board-wire-types'
import type {
  GlobalTaskStartSettings,
  TaskStartRole
} from '../../../../../shared/task-board/task-start-settings'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { RepositoryTaskStartView, repoInheritedLabels } from './RepositoryTaskStartSection'

const efforts = [
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' }
]
const catalog: TaskStartAgentCatalogEntry[] = [
  { agent: 'claude', label: 'Claude', models: [{ id: 'sonnet', label: 'Sonnet', efforts }] },
  {
    agent: 'claude',
    accountId: 'ucloud',
    label: 'Claude (Ucloud)',
    models: [{ id: 'opus', label: 'Opus', efforts }]
  },
  { agent: 'codex', label: 'Codex', models: [{ id: 'gpt-5', label: 'GPT-5', efforts }] }
]
const global: GlobalTaskStartSettings = {
  roles: {
    orchestrator: { agent: 'claude' },
    reviewer: { agent: 'codex', model: 'gpt-5' }
  }
}

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repos/acme-web',
    displayName: 'acme-web',
    badgeColor: '#3b82f6',
    addedAt: 0,
    ...overrides
  }
}

function fixture(r: Repo, invalidRoles?: TaskStartRole[]) {
  const inherited = repoInheritedLabels({
    global,
    repoTaskStart: r.taskStart,
    defaultAgent: 'claude',
    catalog,
    fallback: 'No default agent'
  })
  return defineFixture({
    width: 640,
    store: { settings: getDefaultSettings('/home/fixture') },
    setup: () => {
      window.api.repos.getBaseRefDefault = () =>
        Promise.resolve({ defaultBaseRef: 'origin/main', remoteCount: 1 })
    },
    render: () => (
      <RepositoryTaskStartView
        repo={r}
        catalog={catalog}
        inherited={inherited}
        invalidRoles={invalidRoles}
        updateRepo={() => {}}
      />
    )
  })
}

export const inheriting = fixture(repo({ worktreeBaseRef: 'origin/develop' }))
export const overridden = fixture(
  repo({
    worktreeBaseRef: 'origin/develop',
    taskStart: {
      workspaceMode: 'primary',
      roles: {
        orchestrator: { agent: 'claude', accountId: 'ucloud', model: 'opus', effort: 'high' },
        reviewer: { agent: 'codex', model: 'gpt-5' }
      }
    }
  })
)
export const folderRepo = fixture(repo({ kind: 'folder' }))
export const invalidRole = fixture(
  repo({ taskStart: { roles: { qa: { agent: 'claude', accountId: 'gone' } } } }),
  ['qa']
)
