import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../search/settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { DatabaseConnectionSummary } from '../../../../../shared/database/database-contracts'
import type { DatabaseSettingsOptions } from '../../../../../shared/database/database-settings-options'
import { databaseProjectIdentityKey } from '../../../../../shared/database/database-project-scope'

export const getDatabaseConnectionsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('database.settings.title', 'Database connections'),
    description: translate(
      'database.settings.description',
      'Register database environments and associate them with projects'
    ),
    keywords: [
      ...translateSearchKeyword('database.search.database', 'database'),
      ...translateSearchKeyword('database.search.postgres', 'postgres'),
      ...translateSearchKeyword('database.search.sqlServer', 'sql server'),
      ...translateSearchKeyword('database.search.oracle', 'oracle'),
      '@',
      ...translateSearchKeyword('database.search.connections', 'connections'),
      ...translateSearchKeyword('database.search.readOnly', 'read-only'),
      ...translateSearchKeyword('database.search.environment', 'environment')
    ]
  }
])
export function filterDatabaseConnections(
  connections: DatabaseConnectionSummary[],
  options: DatabaseSettingsOptions | null,
  query: string,
  engine: string
) {
  const needle = query.trim().toLowerCase()
  const projects = new Map(options?.projects.map((project) => [project.key, project.label]) ?? [])
  const hosts = new Map(options?.hosts.map((host) => [host.executionHostId, host.label]) ?? [])
  return connections.filter(
    (connection) =>
      (engine === 'all' || connection.engine === engine) &&
      [
        connection.alias,
        connection.displayName,
        connection.engine,
        connection.environment,
        hosts.get(connection.executionHostId) ?? connection.executionHostId,
        ...connection.projects.map(
          (project) => projects.get(databaseProjectIdentityKey(project)) ?? project.projectId
        )
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
  )
}
