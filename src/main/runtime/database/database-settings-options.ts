import { getAppEnvironment } from '../../../shared/app-environment'
import {
  getLocalExecutionHostLabel,
  getRepoExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../shared/execution-host'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type {
  DatabaseSettingsOptions,
  DatabaseHostCapabilities
} from '../../../shared/database/database-settings-options'
import { databaseProjectIdentityKey } from '../../../shared/database/database-project-scope'
import { resolveDatabaseProject, type DatabaseRuntimeHost } from './database-project-context'

export async function databaseSettingsOptions(
  runtime: DatabaseRuntimeHost,
  nativeCapabilities: DatabaseHostCapabilities
): Promise<DatabaseSettingsOptions> {
  const store = runtime.requireStore()
  const projects = new Map<string, DatabaseSettingsOptions['projects'][number]>()
  for (const repo of runtime.listRepos()) {
    const project = await resolveDatabaseProject(runtime, {
      project: repo.id,
      executionHostId: getRepoExecutionHostId(repo)
    })
    const key = databaseProjectIdentityKey(project)
    if (!projects.has(key)) {
      projects.set(key, {
        key,
        project,
        label: repo.displayName,
        path: repo.path,
        badgeColor: repo.badgeColor
      })
    }
  }
  for (const folder of store.getFolderWorkspaces?.() ?? []) {
    const project = {
      kind: 'folder' as const,
      projectId: folder.id,
      executionHostId: folder.executionHostId ?? getRepoExecutionHostId(folder)
    }
    const key = databaseProjectIdentityKey(project)
    projects.set(key, { key, project, label: folder.name, path: folder.folderPath, badgeColor: '' })
  }
  return {
    projects: [...projects.values()],
    hosts: [
      {
        executionHostId: 'local',
        label: getLocalExecutionHostLabel(),
        capabilities: nativeCapabilities
      },
      ...listEnvironments(getAppEnvironment().getPath('userData')).map((environment) => ({
        executionHostId: toRuntimeExecutionHostId(environment.id),
        label: environment.name
      }))
    ]
  }
}
